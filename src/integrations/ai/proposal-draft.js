const DURATION_DAYS = { short: 14, medium: 45, long: 90 };

function skillOverlap(job, profile) {
  const profileSkills = new Set((profile?.skills || []).map((skill) => skill.toLowerCase()));
  const jobSkills = (job.skills || []).map(String);
  return {
    matchedSkills: jobSkills.filter((skill) => profileSkills.has(skill.toLowerCase())),
    missingSkills: jobSkills.filter((skill) => !profileSkills.has(skill.toLowerCase())),
  };
}

function suggestedBid(job, profile) {
  const type = job.budget?.type || 'fixed';
  const min = Number(job.budget?.min) || 0;
  const max = Number(job.budget?.max) || 0;
  let amount = min && max ? (min + max) / 2 : max || min || 100;
  if (type === 'hourly' && Number(profile?.hourlyRate) > 0) amount = Number(profile.hourlyRate);
  if (min) amount = Math.max(min, amount);
  if (max) amount = Math.min(max, amount);
  return {
    amount: Math.round(amount * 100) / 100,
    type,
    currency: job.budget?.currency || 'USD',
  };
}

function talkingPoints(job, profile, matchedSkills, notes) {
  const items = [];
  if (matchedSkills.length) items.push(`Describe one result you delivered using ${matchedSkills.slice(0, 4).join(', ')}.`);
  const recentRole = profile?.experience?.[0];
  if (recentRole?.title) items.push(`Connect your ${recentRole.title} experience directly to this project's outcome.`);
  if (profile?.portfolio?.length) items.push('Link the most relevant portfolio item and explain your contribution.');
  if (notes) items.push('Check that every extra detail you supplied is accurate and relevant.');
  items.push('End with one specific question about scope, data, or delivery priorities.');
  return items.slice(0, 5);
}

export function draftProposalWithHeuristics(job, profile, tone = 'professional', notes = '') {
  const { matchedSkills, missingSkills } = skillOverlap(job, profile);
  const days = DURATION_DAYS[job.duration] || DURATION_DAYS.medium;
  const title = job.title || 'this project';
  const skillText = matchedSkills.length
    ? `My profile includes ${matchedSkills.slice(0, 5).join(', ')}, which matches the main skills in your brief.`
    : 'I have reviewed the requested outcome carefully and would begin by confirming the scope and delivery priorities.';
  const profileText = profile?.title
    ? `As a ${profile.title}, I focus on clear communication, reviewable progress, and dependable delivery.`
    : 'I focus on clear communication, reviewable progress, and dependable delivery.';
  const noteText = notes ? `I would also account for this priority: ${notes.trim().slice(0, 500)}` : '';

  const openers = {
    professional: `Hello,\n\nI am interested in your “${title}” project and have reviewed the requirements carefully.`,
    friendly: `Hello!\n\nYour “${title}” project caught my attention, and I would be glad to help you deliver it.`,
    concise: `Hello,\n\nI can help deliver “${title}” with a clear, testable, milestone-based workflow.`,
  };

  const paragraphs = [
    openers[tone] || openers.professional,
    `${profileText} ${skillText}`,
    'I would start with a short requirements check, deliver an initial working version for early feedback, and then complete testing and final handoff. This keeps progress visible and reduces late surprises.',
    noteText,
    `I estimate approximately ${days} days for delivery, subject to confirming the final scope. If this approach fits, I would be happy to discuss the highest-priority requirement first.\n\nThank you for your consideration.`,
  ].filter(Boolean);

  return {
    coverLetter: paragraphs.join('\n\n').slice(0, 5000),
    suggestedBid: suggestedBid(job, profile),
    suggestedDays: days,
    talkingPoints: talkingPoints(job, profile, matchedSkills, notes),
    matchedSkills,
    missingSkills,
    tone,
    disclaimer: 'This is an advisory draft generated from the job and your saved profile. Review every claim and edit it before submitting.',
  };
}
