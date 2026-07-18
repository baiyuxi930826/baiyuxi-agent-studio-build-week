/* F056 OKLCH Tuner — CSS generation + export text.
 * Split from oklch-tuner-engine.ts to stay under 350-line hard limit. */
import type {
  ColorTier,
  HcOverride,
  Mode,
  ModeP,
  NeutralP,
  SemanticP,
  SurfaceP,
  TunerState,
} from './oklch-tuner-engine';
import { COLOR_TIERS, INIT } from './oklch-tuner-engine';

/* ── CSS generation ── */
export function buildCSS(p: TunerState, hc: HcOverride): string {
  const ok = (m: ModeP, t: ColorTier, h: string, c: string) => `oklch(${m[t].L} calc(${c} * ${m[t].Cmul}) ${h})`;
  const it = (m: ModeP) => `oklch(${m.insetText.L} ${m.insetText.C} 250)`;
  /* Defensive: old persisted data may lack msgText (added mid-PR) */
  const mt = (m: ModeP) => {
    const msg = m.msgText ?? INIT.light.msgText;
    return `oklch(${msg.L} ${msg.C} ${p.neutralHue})`;
  };

  // 1. Accent + surface hue — accent cascades to --accent-*, surface hue is independent (KD-34)
  const sH = p.surfaceHue ?? 80;
  const accent = `:root{--accent-hue:${p.accentHue};--accent-chroma:${p.accentChroma};--surface-hue:${sH};}`;

  // 1b. Agent tier gradients — per-slug tokens in agent-persona-tokens.css consume these
  const agentGradients = (m: ModeP, dark: boolean) => {
    const sel = dark ? '[data-theme="dark"]' : ':root';
    /* Defensive: old persisted data may lack msgText */
    const msg = m.msgText ?? (dark ? INIT.dark.msgText : INIT.light.msgText);
    /* Agent name text: unified H/L/C across all agents. CSS formulas in
     * agent-persona-tokens.css consume --agent-name-l/c/h (not per-agent hue).
     * This avoids fragile source-order override of final --color-{slug}-text. */
    const nameL = dark ? p.agentTextDarkL : p.agentTextLightL;
    return (
      `${sel}{` +
      `--agent-bubble-l:${m.primary.L};--agent-bubble-cmul:${m.primary.Cmul};` +
      `--agent-surface-l:${m.surface.L};--agent-surface-cmul:${m.surface.Cmul};` +
      `--agent-text-l:${m.text.L};--agent-text-cmul:${m.text.Cmul};` +
      `--agent-ring-l:${m.ring.L};--agent-ring-cmul:${m.ring.Cmul};` +
      `--agent-inset-l:${m.inset.L};--agent-inset-cmul:${m.inset.Cmul};` +
      `--agent-inset-text-l:${m.insetText.L};--agent-inset-text-c:${m.insetText.C};` +
      `--agent-msg-text-l:${msg.L};--agent-msg-text-c:${msg.C};` +
      `--agent-name-l:${nameL};--agent-name-c:${p.agentTextC};--agent-name-h:${p.agentTextH};}`
    );
  };

  // 2. Surface elevation — hue + chroma independent of accent (KD-34)
  const sCmul = p.surfaceChroma ?? 1;
  const surf = (e: SurfaceP, dark: boolean) => {
    const sel = dark ? '[data-theme="dark"]' : ':root';
    const ch = [0.015, 0.012, 0.005, 0.003].map((c) => +(c * sCmul).toFixed(4));
    const h = sH;
    return (
      `${sel}{` +
      `--studio-surface-sunken:oklch(${e.sunken} ${ch[0]} ${h});` +
      `--studio-surface:oklch(${e.base} ${ch[1]} ${h});` +
      `--studio-surface-elevated:oklch(${e.elevated} ${ch[2]} ${h});` +
      `--studio-surface-canvas:oklch(${e.canvas} ${ch[3]} ${h});}`
    );
  };

  // 3. Runtime message derived (.agent-persona-derived)
  const mH = hc.on ? `${hc.hue}` : 'var(--msg-hue,297)';
  const mC = hc.on ? `${hc.chroma}` : 'var(--msg-chroma,0.1)';
  const drv = (m: ModeP, dark: boolean) => {
    const sel = dark ? '[data-theme="dark"] .agent-persona-derived' : '.agent-persona-derived';
    return (
      `${sel}{` +
      `--agent-msg-bubble:${ok(m, 'primary', mH, mC)};` +
      `--agent-msg-surface:${ok(m, 'surface', mH, mC)};` +
      `--agent-msg-inset:${ok(m, 'inset', mH, mC)};` +
      `--agent-msg-inset-text:${it(m)};` +
      `--agent-msg-text:${mt(m)};` +
      `--agent-msg-ring:${ok(m, 'ring', mH, mC)};}`
    );
  };

  // 5. Force all agents to same H/C (!important to beat inline styles)
  const force = hc.on
    ? `.agent-persona-derived{--msg-hue:${hc.hue}!important;--msg-chroma:${hc.chroma}!important;}`
    : '';

  // 6. Semantic status colors (critical / success / warning / info + surface variants)
  const semCSS = (s: SemanticP, dark: boolean) => {
    const sel = dark ? '[data-theme="dark"]' : ':root';
    return (
      `${sel}{` +
      `--semantic-critical:oklch(${s.L} ${s.C} ${s.criticalH});` +
      `--semantic-success:oklch(${s.L} ${s.C} ${s.successH});` +
      `--semantic-warning:oklch(${s.L} ${s.C} ${s.warningH});` +
      `--semantic-info:oklch(${s.L} ${s.C} ${s.infoH});` +
      `--semantic-spotlight:oklch(${s.L + 0.1} ${s.C} ${s.warningH});` +
      `--semantic-critical-surface:oklch(${s.surfL} ${s.surfC} ${s.criticalH});` +
      `--semantic-success-surface:oklch(${s.surfL} ${s.surfC} ${s.successH});` +
      `--semantic-warning-surface:oklch(${s.surfL} ${s.surfC + 0.01} ${s.warningH});` +
      `--semantic-info-surface:oklch(${s.surfL} ${s.surfC} ${s.infoH});` +
      `--semantic-spotlight-surface:oklch(${s.surfL} ${s.surfC + 0.01} ${s.warningH});}`
    );
  };

  // 7. Queue accent (overrides fixed hex with OKLCH)
  const q = p.queue;
  const qLight =
    `:root{--queue-accent:oklch(${q.L} ${q.C} ${q.H});` +
    `--queue-accent-hover:oklch(${q.L - 0.06} ${q.C + 0.01} ${q.H});` +
    `--queue-accent-surface:oklch(0.96 ${q.C * 0.2} ${q.H});` +
    `--queue-on-accent:oklch(1 0 0);}`;
  const qDark =
    `[data-theme="dark"]{--queue-accent:oklch(${q.L + 0.16} ${q.C + 0.02} ${q.H});` +
    `--queue-accent-hover:oklch(${q.L + 0.22} ${q.C + 0.04} ${q.H});` +
    `--queue-accent-surface:oklch(0.25 ${q.C * 0.4} ${q.H});` +
    `--queue-on-accent:oklch(0.18 0.03 ${q.H});}`;

  // 8. Neutral text/border (overrides --studio-text/border aliases) + code tokens
  const nCSS = (n: NeutralP, dark: boolean) => {
    const sel = dark ? '[data-theme="dark"]' : ':root';
    const o = (l: number) => `oklch(${l} ${p.neutralChroma} ${p.neutralHue})`;
    const codeBg = `oklch(${n.codeBgL ?? (dark ? 0.2 : 0.985)} 0.005 ${p.neutralHue})`;
    const codeTx = `oklch(${n.codeTextL ?? (dark ? 0.92 : 0.22)} 0.02 ${p.neutralHue})`;
    return `${sel}{--studio-text:${o(n.textL)};--studio-text-secondary:${o(n.secondaryL)};--studio-text-muted:${o(n.mutedL)};--studio-interactive:${o(n.interactiveL)};--studio-border:${o(n.borderL)};--studio-border-subtle:${o(n.borderSubtleL)};--code-bg:${codeBg};--code-text:${codeTx};}`;
  };

  // 9. Hub editor preview — each preview class gets its own mode's values so light
  //    preview always has light text/surface and dark preview always has dark text/surface,
  //    regardless of the current [data-theme].
  const pvw = (m: ModeP, dark: boolean): string => {
    const cls = dark ? '.agent-persona-preview-dark' : '.agent-persona-preview-light';
    const msg = m.msgText ?? (dark ? INIT.dark.msgText : INIT.light.msgText);
    const mc = 'var(--msg-chroma,0.1)';
    const mh = 'var(--msg-hue,297)';
    return (
      `${cls}{` +
      `--agent-msg-surface:oklch(${m.surface.L} calc(${mc}*${m.surface.Cmul}) ${mh});` +
      `--agent-msg-inset:oklch(${m.inset.L} calc(${mc}*${m.inset.Cmul}) ${mh});` +
      `--agent-msg-inset-text:oklch(${m.insetText.L} ${m.insetText.C} 250);` +
      `--agent-msg-text:oklch(${msg.L} ${msg.C} ${p.neutralHue});}`
    );
  };

  return [
    accent,
    // --agent-{tier}-l/cmul → agent-persona-tokens.css per-slug formulas + AgentHueInjector
    agentGradients(p.light, false),
    agentGradients(p.dark, true),
    surf(p.light.elev, false),
    surf(p.dark.elev, true),
    drv(p.light, false),
    drv(p.dark, true),
    force,
    semCSS(p.semanticLight, false),
    semCSS(p.semanticDark, true),
    qLight,
    qDark,
    nCSS(p.neutralLight, false),
    nCSS(p.neutralDark, true),
    pvw(p.light, false),
    pvw(p.dark, true),
  ]
    .filter(Boolean)
    .join('\n');
}

/* ── Export text (Copy button) — exports current mode only ── */
export function exportText(p: TunerState, activeMode: Mode): string {
  const r = (t: ColorTier) =>
    `  ${t.padEnd(9)} L=${p[activeMode][t].L.toFixed(2)}  C*${p[activeMode][t].Cmul.toFixed(2)}`;
  const fx = (k: 'insetText' | 'msgText') =>
    `  ${k.padEnd(9)} L=${p[activeMode][k].L.toFixed(2)}  C=${p[activeMode][k].C.toFixed(3)}`;
  const e = p[activeMode].elev;
  const semP = activeMode === 'light' ? p.semanticLight : p.semanticDark;
  const neuP = activeMode === 'light' ? p.neutralLight : p.neutralDark;
  const agentNameL = activeMode === 'light' ? p.agentTextLightL : p.agentTextDarkL;
  const sem = (s: SemanticP) =>
    `  H: crit=${s.criticalH} suc=${s.successH} warn=${s.warningH} info=${s.infoH}  L=${s.L.toFixed(2)} C=${s.C.toFixed(3)} surfL=${s.surfL.toFixed(2)} surfC=${s.surfC.toFixed(3)}`;
  const n = (np: NeutralP) =>
    `txt=${np.textL} sec=${np.secondaryL} mut=${np.mutedL} int=${np.interactiveL} bdr=${np.borderL} sub=${np.borderSubtleL} codeBg=${np.codeBgL} codeTx=${np.codeTextL}`;
  return [
    `OKLCH Token Values (${activeMode})`,
    `accent H=${p.accentHue} C=${p.accentChroma}`,
    `surface H=${p.surfaceHue} C*=${p.surfaceChroma}`,
    '='.repeat(30),
    `${activeMode}:`,
    ...COLOR_TIERS.map((t) => r(t)),
    fx('insetText'),
    fx('msgText'),
    `  elevation: ${e.sunken}/${e.base}/${e.elevated}/${e.canvas}`,
    '',
    `semantic (${activeMode}):`,
    sem(semP),
    `queue: H=${p.queue.H} C=${p.queue.C} L=${p.queue.L}`,
    `neutral: H=${p.neutralHue} C=${p.neutralChroma}  ${n(neuP)}`,
    `agentText: H=${p.agentTextH} C=${p.agentTextC} L=${agentNameL}`,
  ].join('\n');
}
