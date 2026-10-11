import mongoose from 'mongoose';
import { HourlyInvoice } from '../models/HourlyInvoice.js';
import { Project } from '../models/Project.js';
import { Contract } from '../models/Contract.js';
import { TimeEntry } from '../models/TimeEntry.js';
import { ActiveTimer } from '../models/ActiveTimer.js';
import { ApiError } from '../utils/ApiError.js';

const sid = (v) => String(v?._id || v);
export function invoiceTotals(entries) {
  const lines = entries.map((e) => {
    const hourlyRateCents = Math.round(e.hourlyRate * 100);
    const amountCents = Math.round(e.durationMinutes * hourlyRateCents / 60);
    if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw ApiError.badRequest('Invalid billable amount');
    return { entry: e._id, revision: e.revision, startedAt: e.startedAt, endedAt: e.endedAt, description: e.description, durationMinutes: e.durationMinutes, hourlyRateCents, amountCents };
  });
  return { lines, totalMinutes: lines.reduce((sum, line) => sum + line.durationMinutes, 0), totalCents: lines.reduce((sum, line) => sum + line.amountCents, 0) };
}
async function access(user, projectId, session = null) {
  const project = await Project.findById(projectId).session(session);
  if (!project || ![project.client, project.freelancer].some((p) => sid(p) === sid(user))) throw ApiError.notFound('Project not found');
  const contract = await Contract.findById(project.contract).session(session);
  if (contract?.budget.type !== 'hourly') throw ApiError.badRequest('Invoices are available for hourly contracts');
  return { project, contract };
}
export const invoiceService = {
  async list(user, projectId, page = 1) {
    await access(user, projectId);
    const filter = { project: projectId };
    const [items, total] = await Promise.all([HourlyInvoice.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(), HourlyInvoice.countDocuments(filter)]);
    return { items, total, page, pages: Math.ceil(total / 20) };
  },
  async create(user, projectId, { from, to }) {
    const lower = new Date(from), upper = new Date(to);
    if (upper <= lower || upper > new Date() || upper - lower > 90 * 86400000) throw ApiError.badRequest('Choose a closed billing period of at most 90 days');
    await HourlyInvoice.init();
    let invoice;
    try {
      await mongoose.connection.transaction(async (session) => {
        const { project, contract } = await access(user, projectId, session);
        invoice = await HourlyInvoice.findOne({ project: project._id, from: lower, to: upper }).session(session);
        if (invoice) return;
        if (await ActiveTimer.exists({ project: project._id, active: true, startedAt: mongoose.trusted({ $lt: upper }) }).session(session)) throw ApiError.conflict('Stop the running timer before closing this period');
        const intersecting = await TimeEntry.find({ project: project._id, status: 'completed', startedAt: mongoose.trusted({ $lt: upper }), endedAt: mongoose.trusted({ $gt: lower }) }).session(session);
        if (!intersecting.length) throw ApiError.badRequest('This billing period has no completed time entries');
        if (intersecting.length > 1000) throw ApiError.badRequest('Choose a smaller billing period');
        if (intersecting.some((e) => e.startedAt < lower || e.endedAt > upper)) throw ApiError.badRequest('Period boundaries must include complete time entries');
        if (intersecting.some((e) => e.invoice)) throw ApiError.conflict('This period includes already invoiced time');
        if (intersecting.some((e) => e.currency !== contract.budget.currency)) throw ApiError.badRequest('Time-entry currencies must match the contract');
        const values = { project: project._id, contract: contract._id, client: project.client, freelancer: project.freelancer, createdBy: user._id, from: lower, to: upper, currency: contract.budget.currency, ...invoiceTotals(intersecting) };
        [invoice] = await HourlyInvoice.create([values], { session });
        for (const entry of intersecting) {
          const result = await TimeEntry.updateOne({ _id: entry._id, revision: entry.revision, invoice: null, status: 'completed' }, { $set: { invoice: invoice._id } }, { session });
          if (result.modifiedCount !== 1) throw ApiError.conflict('Time changed while the invoice was created; retry');
        }
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      await access(user, projectId);
      invoice = await HourlyInvoice.findOne({ project: projectId, from: lower, to: upper });
      if (!invoice) throw ApiError.conflict('This period overlaps another invoice');
    }
    return invoice;
  },
};
