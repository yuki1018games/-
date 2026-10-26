export type TrigFunc = 'sin' | 'cos' | 'tan' | 'rad' | 'inv_sin' | 'inv_cos' | 'inv_tan';
export type ProblemCategory = 'trig' | 'deg_trig' | 'radian' | 'inverse_deg' | 'degree_all' | 'mix';

export type ExactValueKey =
  | '-1'
  | '-sqrt3/2'
  | '-sqrt2/2'
  | '-1/2'
  | '0'
  | '1/2'
  | 'sqrt2/2'
  | 'sqrt3/2'
  | '1'
  | '-sqrt3'
  | '-1_tan'
  | '-1/sqrt3'
  | '0_tan'
  | '1/sqrt3'
  | '1_tan'
  | 'sqrt3'
  | 'undefined';

export interface ExactValueItem {
  key: string; // e.g. "sqrt3/2", "-1/2", "undefined"
  label: string; // Plain text fallback
  numerator?: string; // for rendering fraction numerator (e.g. "√3")
  denominator?: string; // (e.g. "2")
  isNegative?: boolean;
  isUndefined?: boolean;
  valueNumeric: number | null; // numeric approx for comparisons
  type: 'sin_cos' | 'tan' | 'both';
  shortcutKey?: string; // keyboard shortcut
}

export interface DegreeValueItem {
  degree: number;
  label: string; // e.g. "60°"
  key: string; // e.g. "deg_60"
  radRef: string; // e.g. "π/3"
  shortcutKey?: string;
}

export interface TrigProblem {
  id: string;
  func: TrigFunc;
  problemType: 'trig_value' | 'rad_to_deg' | 'deg_trig_value' | 'inverse_to_deg';
  angleRad: string; // e.g. "π/3", "3π/4", "0"
  angleDegree: number; // e.g. 60
  angleNumericRad: number; // e.g. Math.PI / 3
  givenValueDisplay?: string; // e.g. "1/2" for sin θ = 1/2
  correctValueKey: string; // matched against ExactValueItem.key or DegreeValueItem.key
  correctDisplay: string; // e.g. "√3/2" or "60°"
  quadrant: 1 | 2 | 3 | 4 | 'axis';
  explanation: string;
  triangleHint?: string; // e.g. "30°-60°-90° (1:2:√3)"
  domainHint?: string; // e.g. "0° ≦ θ ≦ 180°"
}

export interface FallingItem {
  id: string;
  problem: TrigProblem;
  xPercent: number; // 10% to 90%
  yPercent: number; // 0% (top) to 100% (hit line)
  speed: number; // % per second
  hpMax: number;
  hpCurrent: number;
  isTargeted?: boolean;
  hitState?: 'normal' | 'hit' | 'wrong';
  createdAt: number;
}

export interface Particle {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface LaserBeam {
  id: string;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  color: string;
  progress: number; // 0 to 1
  createdAt: number;
}

export type GameDifficulty = 'beginner' | 'standard' | 'advanced' | 'master';
export type GameMode = 'survival' | 'timeattack' | 'practice';

export interface GameStats {
  score: number;
  combo: number;
  maxCombo: number;
  correctCount: number;
  wrongCount: number;
  missedCount: number;
  accuracy: number;
  timeSurvivedSeconds: number;
  level: number;
  missedProblems: Array<{
    problem: TrigProblem;
    userAnswer?: string;
    reason: 'timeout' | 'wrong';
  }>;
}
