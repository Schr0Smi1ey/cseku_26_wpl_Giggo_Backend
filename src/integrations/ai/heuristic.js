const SKILLS = [
  'javascript', 'typescript', 'python', 'java', 'c++', 'react', 'vue', 'angular', 'node.js',
  'express', 'mongodb', 'postgresql', 'mysql', 'aws', 'azure', 'docker', 'kubernetes', 'git',
  'figma', 'tailwind', 'html', 'css', 'excel', 'seo', 'machine learning', 'data analysis',
];

const DISCLAIMER = 'This analysis is advisory only. It assesses CV presentation, not identity, qualifications, or the truth of any claim.';

function containsSkill(text, skill) {
  const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9+#])${escaped}([^a-z0-9+#]|$)`, 'i').test(text);
}

export function analyzeWithHeuristics(text, profile) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const detectedSkills = SKILLS.filter((skill) => containsSkill(text, skill));
  const experienceMatches = [...text.matchAll(/(\d{1,2})\s*\+?\s*(?:years|yrs)/gi)].map((match) => Number(match[1]));
  const experienceYears = Math.min(40, Math.max(0, ...experienceMatches, 0));
  const sections = {
    summary: /\b(summary|objective|profile)\b/i,
    experience: /\b(experience|employment|work history)\b/i,
    education: /\b(education|university|degree)\b/i,
    skills: /\b(skills|technologies|technical skills)\b/i,
    contact: /@|linkedin|github|\bphone\b/i,
  };
  const missingSections = Object.entries(sections)
    .filter(([, pattern]) => !pattern.test(text))
    .map(([name]) => name);
  const hasMetrics = /\d+%|\$\s?\d|\d+\s*(users|clients|projects|requests|sales)/i.test(text);
  const hasActionVerbs = /\b(built|created|delivered|designed|developed|improved|increased|led|reduced)\b/i.test(text);

  const sectionScore = (5 - missingSections.length) * 9;
  const skillScore = Math.min(30, detectedSkills.length * 3);
  const contentScore = Math.min(25, words / 10);
  const overallScore = Math.min(100, Math.round(sectionScore + skillScore + contentScore));
  const atsScore = Math.min(100, Math.round(
    (missingSections.includes('contact') ? 0 : 20)
      + (missingSections.includes('skills') ? 0 : 25)
      + (missingSections.includes('experience') ? 0 : 20)
      + Math.min(25, detectedSkills.length * 4)
      + (hasMetrics ? 10 : 3),
  ));

  const existingSkills = new Set((profile?.skills || []).map((skill) => skill.toLowerCase()));
  const recommendations = [];
  if (missingSections.includes('skills')) recommendations.push({ title: 'Add a skills section', detail: 'List relevant tools and technologies so clients and applicant tracking systems can find them.', priority: 'high' });
  if (!hasMetrics) recommendations.push({ title: 'Quantify outcomes', detail: 'Add measurable results such as delivery time, performance improvement, users served, or revenue impact.', priority: 'high' });
  if (missingSections.includes('summary')) recommendations.push({ title: 'Add a concise summary', detail: 'Open with your role, specialty, experience, and strongest evidence in two or three sentences.', priority: 'medium' });
  if (!hasActionVerbs) recommendations.push({ title: 'Use action-led bullets', detail: 'Start experience bullets with clear verbs such as built, delivered, improved, or led.', priority: 'medium' });

  return {
    summary: `Detected ${detectedSkills.length} relevant skill(s) across ${words} words.`,
    overallScore,
    atsScore,
    detectedSkills,
    suggestedSkills: detectedSkills.filter((skill) => !existingSkills.has(skill)).slice(0, 15),
    experienceYears,
    seniority: experienceYears >= 5 ? 'senior' : experienceYears >= 2 ? 'mid' : 'junior',
    strengths: [
      detectedSkills.length >= 5 ? 'Shows a useful breadth of recognizable technical skills.' : 'The CV has readable content that can be improved iteratively.',
      hasMetrics ? 'Includes measurable achievements.' : '',
      hasActionVerbs ? 'Uses action-oriented language.' : '',
    ].filter(Boolean),
    weaknesses: missingSections.map((section) => `Missing or unclear ${section} section.`),
    recommendations,
    missingSections,
    wordCount: words,
    disclaimer: DISCLAIMER,
  };
}
