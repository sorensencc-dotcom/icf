export const PRIORITY_INDEX_WEIGHTS = {
  directive: 0.46,
  roi: 0.34,
  velocity: 0.2
};

const DIRECTIVE_WEIGHT = {
  IMPLEMENT: 1,
  EVALUATE: 0.62,
  RESEARCH: 0.38
};

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function directiveOf(card) {
  const fields = [card?.directive, card?.category, card?.action_type, card?.direction]
    .map((value) => String(value || '').toUpperCase());
  const hit = (name) => fields.some((value) => value === name || value.includes(name));
  const status = String(card?.status || '').toUpperCase();
  if (hit('RESEARCH') || status === 'RESEARCH' || status === 'STAGED_FOR_RESEARCH') return 'RESEARCH';
  if (hit('EVALUATE') || hit('FEASIBILITY')) return 'EVALUATE';
  if (card?.research_ref && !hit('IMPLEMENT')) return 'RESEARCH';
  return 'IMPLEMENT';
}

export function cardAgeDays(card, now = Date.now()) {
  const raw = card?.created_date || card?.created_at || card?.created || card?.timestamp || card?.processed_at;
  let ms = NaN;
  if (typeof raw === 'number') ms = raw;
  else if (raw !== null && raw !== undefined && raw !== '') {
    const text = String(raw).trim();
    const day = text.match(/^(\d{4}-\d{2}-\d{2})/);
    ms = Date.parse(day ? `${day[1]}T00:00:00Z` : text);
  }
  if (!Number.isFinite(ms) && card?.id) {
    const id = String(card.id);
    const epoch = id.match(/^act-(\d{13})(?:\D|$)/);
    const ymd = id.match(/^act-(\d{4})(\d{2})(\d{2})(?:\D|$)/);
    if (epoch) ms = Number(epoch[1]);
    else if (ymd) ms = Date.parse(`${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00Z`);
  }
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, (now - ms) / 86_400_000);
}

export function agingFactor(ageDays) {
  if (ageDays >= 7) return 1.55;
  if (ageDays >= 6) return 1.35;
  if (ageDays >= 4) return 1.15;
  if (ageDays >= 2) return 1.05;
  return 1;
}

export function scorePriorityIndex(card, now = Date.now()) {
  const directive = directiveOf(card);
  const directiveWeight = DIRECTIVE_WEIGHT[directive];
  const roiRaw = numberOrNull(card?.roi_score ?? card?.harvest_roi ?? card?.roi);
  const roi = roiRaw === null ? 0 : clamp(roiRaw, 0, 100);
  const velocityRaw = numberOrNull(card?.velocity_delta ?? card?.velocityDelta);
  const velocity = velocityRaw === null ? 0 : velocityRaw;
  const ageDays = cardAgeDays(card, now);
  const aging = agingFactor(ageDays);
  const manual = String(card?.priority || 'P2').toUpperCase();
  const manualPriority = manual === 'P0' || manual === 'P1' ? manual : (manual === 'P3' ? 'P3' : 'P2');
  const nudge = manualPriority === 'P0' || manualPriority === 'P1' ? 6 : (manualPriority === 'P3' ? -6 : 0);
  const raw = (
    PRIORITY_INDEX_WEIGHTS.directive * directiveWeight
    + PRIORITY_INDEX_WEIGHTS.roi * (roi / 100)
    + PRIORITY_INDEX_WEIGHTS.velocity * clamp((velocity + 20) / 40, 0, 1)
  ) * aging * 100;
  return {
    index: Math.round((raw + nudge) * 10) / 10,
    directive,
    directive_weight: directiveWeight,
    roi,
    roi_known: roiRaw !== null,
    velocity,
    velocity_known: velocityRaw !== null,
    age_days: Math.round(ageDays * 10) / 10,
    aging,
    nudge,
    manual_priority: manualPriority
  };
}
