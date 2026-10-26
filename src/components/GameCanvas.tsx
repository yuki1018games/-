import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FallingItem, GameDifficulty, GameMode, GameStats, LaserBeam, Particle, ProblemCategory, TrigFunc, TrigProblem } from '../types/trig';
import { getRandomProblem } from '../utils/trigData';
import { sounds } from '../utils/audio';
import { TrigExpression, MathValueDisplay, FormattedMathText } from './MathDisplay';
import { TrigTableModal } from './TrigTableModal';
import { Heart, Shield, Zap, Flame, AlertTriangle, Target, Table } from 'lucide-react';

interface GameCanvasProps {
  difficulty: GameDifficulty;
  mode: GameMode;
  category?: ProblemCategory;
  includeTan: boolean;
  onGameOver: (stats: GameStats) => void;
  onQuit: () => void;
  externalSelectedValueKey: string | null;
  onValueProcessed: () => void;
  showUnitCircleAssist?: boolean;
  onTargetChange?: (func: TrigFunc) => void;
  initialSpeedSetting?: SpeedSetting;
  onSpeedChange?: (speed: SpeedSetting) => void;
}

export type SpeedSetting = 'very_slow' | 'slow' | 'normal' | 'fast';

// Vertical boundary constants
const SPAWN_Y = 14; // 14% ensures the full capsule is completely visible below the top HUD
const DEFENSE_LINE_Y = 91; // Lowered to 91% for maximum descent room and reaction time

export const GameCanvas: React.FC<GameCanvasProps> = ({
  difficulty,
  mode,
  category = 'trig',
  includeTan,
  onGameOver,
  onQuit,
  externalSelectedValueKey,
  onValueProcessed,
  onTargetChange,
  initialSpeedSetting = 'slow',
  onSpeedChange,
}) => {
  // Game Settings based on difficulty
  const maxHp = difficulty === 'beginner' ? 5 : difficulty === 'standard' ? 4 : 3;
  const [hp, setHp] = useState<number>(maxHp);
  const [score, setScore] = useState<number>(0);
  const [combo, setCombo] = useState<number>(0);
  const [maxCombo, setMaxCombo] = useState<number>(0);
  const [level, setLevel] = useState<number>(1);
  const [timeSurvived, setTimeSurvived] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(60); // for timeattack

  // Trig Table Modal state
  const [showTrigTable, setShowTrigTable] = useState<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  isPausedRef.current = showTrigTable;

  // Speed multiplier setting
  const [speedSetting, setSpeedSetting] = useState<SpeedSetting>(initialSpeedSetting);

  // Synchronize if prop changes externally
  useEffect(() => {
    if (initialSpeedSetting) {
      setSpeedSetting(initialSpeedSetting);
    }
  }, [initialSpeedSetting]);

  // Next spawn delay timestamp
  const nextSpawnTimeRef = useRef<number>(0);
  const [isWaitingNext, setIsWaitingNext] = useState<boolean>(false);

  // Missed flash notification
  const [missNotification, setMissNotification] = useState<{
    problem: TrigProblem;
    timestamp: number;
  } | null>(null);

  // Recovery notification
  const [healNotification, setHealNotification] = useState<boolean>(false);

  // Screen shake
  const [screenShake, setScreenShake] = useState<boolean>(false);

  // Internal state refs for 60fps loop
  const containerRef = useRef<HTMLDivElement>(null);
  const fallingItemsRef = useRef<FallingItem[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lasersRef = useRef<LaserBeam[]>([]);
  const animationFrameId = useRef<number | null>(null);

  // Store props and dynamic configs in stable refs to prevent effect tear-down and freezes
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;
  const onTargetChangeRef = useRef(onTargetChange);
  onTargetChangeRef.current = onTargetChange;
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const categoryRef = useRef(category);
  categoryRef.current = category;
  const includeTanRef = useRef(includeTan);
  includeTanRef.current = includeTan;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const speedSettingRef = useRef(speedSetting);
  speedSettingRef.current = speedSetting;
  const levelRef = useRef(level);
  levelRef.current = level;
  const timeSurvivedRef = useRef<number>(0);
  const timeLeftRef = useRef<number>(60);

  // Dedicated lightweight render ticker (60fps) to schedule visual re-render without tearing down loops
  const [, setRenderTick] = useState<number>(0);

  const statsRef = useRef<GameStats>({
    score: 0,
    combo: 0,
    maxCombo: 0,
    correctCount: 0,
    wrongCount: 0,
    missedCount: 0,
    accuracy: 100,
    timeSurvivedSeconds: 0,
    level: 1,
    missedProblems: [],
  });

  const hpRef = useRef<number>(maxHp);
  hpRef.current = hp;

  // Track primary targeted item
  const [targetedItemId, setTargetedItemId] = useState<string | null>(null);

  // Calculate speed (% per second).
  // Distance from SPAWN_Y (14%) to DEFENSE_LINE_Y (91%) is 77%.
  // Fall times precisely configured to user request:
  // - ゆっくり: 15秒 (77 / 15 = 5.133 %/s)
  // - ふつう: 10秒 (77 / 10 = 7.70 %/s)
  // - 速い: 6秒 (77 / 6 = 12.833 %/s)
  // - 最遅: 25秒 (77 / 25 = 3.08 %/s)
  const getSpeed = useCallback((lvl: number, setting: SpeedSetting) => {
    const baseSpeed = {
      very_slow: 77 / 25, // 25秒で落下
      slow: 77 / 15,      // 15秒で落下（指定値）
      normal: 77 / 10,    // 10秒で落下（指定値）
      fast: 77 / 6,       // 6秒で落下（指定値）
    }[setting];

    // Gentle level ramp (+0.04% per level)
    return baseSpeed + (lvl - 1) * 0.04;
  }, []);

  // Handler for speed changes in HUD
  const handleSpeedChange = (newSpeed: SpeedSetting) => {
    setSpeedSetting(newSpeed);
    speedSettingRef.current = newSpeed;
    onSpeedChange?.(newSpeed);
    if (fallingItemsRef.current[0]) {
      fallingItemsRef.current[0].speed = getSpeed(levelRef.current, newSpeed);
    }
  };

  // Spawn a SINGLE new item in the central lane
  const spawnItem = useCallback(() => {
    // Enforce strictly one item at a time!
    if (fallingItemsRef.current.length > 0) return;

    const problem = getRandomProblem(
      difficultyRef.current,
      includeTanRef.current,
      categoryRef.current,
      []
    );

    // Strictly center lane (50%) for clear focus and direct alignment with cannon
    const x = 50;

    const newItem: FallingItem = {
      id: problem.id,
      problem,
      xPercent: x,
      yPercent: SPAWN_Y,
      speed: getSpeed(levelRef.current, speedSettingRef.current),
      hpMax: 1,
      hpCurrent: 1,
      createdAt: performance.now(),
    };

    fallingItemsRef.current = [newItem];
    setIsWaitingNext(false);
    onTargetChangeRef.current?.(newItem.problem.func);
  }, [getSpeed]);

  // Create explosion particles at (x%, y%)
  const createExplosion = (xPercent: number, yPercent: number, color: string) => {
    const count = 16;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 4.5;
      particlesRef.current.push({
        id: Math.random().toString(),
        x: xPercent,
        y: yPercent,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 3 + Math.random() * 4,
        alpha: 1,
        life: 0,
        maxLife: 25 + Math.random() * 15,
      });
    }
  };

  // Handle player answer attempt
  const handleAnswerInput = useCallback((valueKey: string) => {
    if (fallingItemsRef.current.length === 0) return;

    // Find the item to check: first check currently targeted item, otherwise lowest item
    const sorted = [...fallingItemsRef.current].sort((a, b) => b.yPercent - a.yPercent);
    const target = sorted[0];

    // Check if correct
    if (target.problem.correctValueKey === valueKey) {
      // Hit!
      sounds.playLaser();
      sounds.playHit();

      // Create laser beam to target
      lasersRef.current.push({
        id: Math.random().toString(),
        startX: 50,
        startY: 94,
        targetX: target.xPercent,
        targetY: target.yPercent,
        color:
          target.problem.func === 'sin'
            ? '#10b981'
            : target.problem.func === 'cos'
            ? '#06b6d4'
            : target.problem.func === 'rad'
            ? '#818cf8'
            : '#f59e0b',
        progress: 1,
        createdAt: performance.now(),
      });

      // Explosion
      createExplosion(
        target.xPercent,
        target.yPercent,
        target.problem.func === 'sin'
          ? '#34d399'
          : target.problem.func === 'cos'
          ? '#38bdf8'
          : target.problem.func === 'rad'
          ? '#a5b4fc'
          : '#fbbf24'
      );

      // Score calculation
      const currentCombo = combo + 1;
      const basePoints = 100;
      const speedBonus = Math.max(10, Math.floor((100 - target.yPercent) * 1.5));
      const comboBonus = currentCombo * 25;
      const totalGained = basePoints + speedBonus + comboBonus;

      setScore(s => s + totalGained);
      setCombo(currentCombo);
      setMaxCombo(mc => Math.max(mc, currentCombo));

      statsRef.current.score += totalGained;
      statsRef.current.combo = currentCombo;
      statsRef.current.maxCombo = Math.max(statsRef.current.maxCombo, currentCombo);
      statsRef.current.correctCount += 1;

      // Play combo sound
      sounds.playCombo(currentCombo);

      // Combo heal every 10 combo
      if (currentCombo > 0 && currentCombo % 10 === 0 && hpRef.current < maxHp) {
        setHp(h => Math.min(maxHp, h + 1));
        setHealNotification(true);
        setTimeout(() => setHealNotification(false), 2000);
      }

      // Check level up every 5 correct
      if (statsRef.current.correctCount % 5 === 0) {
        setLevel(lvl => {
          const next = lvl + 1;
          levelRef.current = next;
          sounds.playLevelUp();
          return next;
        });
      }

      // Remove target and set pause before next question (tuned to speed setting)
      fallingItemsRef.current = [];
      setIsWaitingNext(true);
      const delayMs = {
        very_slow: 800,
        slow: 600,
        normal: 450,
        fast: 280,
      }[speedSettingRef.current];
      nextSpawnTimeRef.current = performance.now() + delayMs;
    } else {
      // Wrong answer - user explicitly requested: "間違えたら、体力が減るようにして"
      sounds.playWrong();
      setCombo(0);
      statsRef.current.combo = 0;
      statsRef.current.wrongCount += 1;
      statsRef.current.missedProblems.push({
        problem: target.problem,
        userAnswer: valueKey,
        reason: 'wrong',
      });

      // Show temporary shake on the target
      target.hitState = 'wrong';
      setTimeout(() => {
        if (target) target.hitState = 'normal';
      }, 300);

      // Decrement HP if in survival mode
      if (modeRef.current === 'survival') {
        sounds.playDamage();
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 350);

        setHp(currentHp => {
          const newHp = currentHp - 1;
          if (newHp <= 0) {
            // Game Over!
            sounds.playGameOver();
            if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
            statsRef.current.timeSurvivedSeconds = Math.floor(timeSurvivedRef.current);
            statsRef.current.level = levelRef.current;
            onGameOverRef.current(statsRef.current);
          }
          return newHp;
        });
      } else if (modeRef.current === 'timeattack') {
        // Time penalty in time attack mode (-3 seconds)
        timeLeftRef.current = Math.max(0, timeLeftRef.current - 3);
        setTimeLeft(Math.ceil(timeLeftRef.current));
        setScreenShake(true);
        setTimeout(() => setScreenShake(false), 300);
      }
    }

    // Update accuracy
    const totalAnswers = statsRef.current.correctCount + statsRef.current.wrongCount + statsRef.current.missedCount;
    statsRef.current.accuracy = totalAnswers > 0
      ? Math.round((statsRef.current.correctCount / totalAnswers) * 100)
      : 100;
  }, [combo, maxHp, createExplosion]);

  // Process external input (from buttons or keyboard)
  useEffect(() => {
    if (externalSelectedValueKey) {
      handleAnswerInput(externalSelectedValueKey);
      onValueProcessed();
    }
  }, [externalSelectedValueKey, handleAnswerInput, onValueProcessed]);

  // Main Game Loop (60 FPS) - Clean & isolated from state update tear-down loops
  useEffect(() => {
    // Reset runtime states for new game
    fallingItemsRef.current = [];
    particlesRef.current = [];
    lasersRef.current = [];
    timeSurvivedRef.current = 0;
    timeLeftRef.current = 60;
    nextSpawnTimeRef.current = 0;
    setIsWaitingNext(false);

    // Initial spawn
    spawnItem();

    let animId = 0;
    let lastTime = performance.now();

    const loop = (currentTime: number) => {
      // Pause game physics and timers when Cheat Sheet is open
      if (isPausedRef.current) {
        lastTime = currentTime;
        animId = requestAnimationFrame(loop);
        return;
      }

      const rawDt = (currentTime - lastTime) / 1000;
      const dt = Math.min(Math.max(rawDt, 0), 0.1); // clamp to 0-100ms
      lastTime = currentTime;

      // 1. Strictly ONE-AT-A-TIME Spawning logic
      if (fallingItemsRef.current.length === 0) {
        if (currentTime >= nextSpawnTimeRef.current) {
          spawnItem();
        }
      }

      // 2. Move the active single item down
      const defenseLineY = DEFENSE_LINE_Y;
      const survivingItems: FallingItem[] = [];

      for (const item of fallingItemsRef.current) {
        item.yPercent += item.speed * dt;

        // Did it hit the defense line?
        if (item.yPercent >= defenseLineY) {
          // Missed! Damage base
          sounds.playDamage();
          setScreenShake(true);
          setTimeout(() => setScreenShake(false), 350);

          setMissNotification({
            problem: item.problem,
            timestamp: currentTime,
          });
          setTimeout(() => {
            setMissNotification(curr => (curr && curr.timestamp === currentTime ? null : curr));
          }, 3600);

          statsRef.current.missedCount += 1;
          statsRef.current.combo = 0;
          setCombo(0);
          statsRef.current.missedProblems.push({
            problem: item.problem,
            reason: 'timeout',
          });

          createExplosion(item.xPercent, defenseLineY, '#ef4444');

          // Schedule next question after a 2.5s breather so user can read explanation
          nextSpawnTimeRef.current = currentTime + 2500;
          setIsWaitingNext(true);

          // Decrement HP if in survival mode
          if (modeRef.current === 'survival') {
            setHp(currentHp => {
              const newHp = currentHp - 1;
              if (newHp <= 0) {
                // Game Over!
                sounds.playGameOver();
                cancelAnimationFrame(animId);
                statsRef.current.timeSurvivedSeconds = Math.floor(timeSurvivedRef.current);
                statsRef.current.level = levelRef.current;
                onGameOverRef.current(statsRef.current);
              }
              return newHp;
            });
          }
        } else {
          survivingItems.push(item);
        }
      }
      fallingItemsRef.current = survivingItems;

      // Update primary target
      if (survivingItems.length > 0) {
        setTargetedItemId(survivingItems[0].id);
        onTargetChangeRef.current?.(survivingItems[0].problem.func);
      } else {
        setTargetedItemId(null);
      }

      // 3. Update particles
      particlesRef.current = particlesRef.current
        .map(p => ({
          ...p,
          x: p.x + p.vx * 0.15,
          y: p.y + p.vy * 0.15,
          alpha: 1 - p.life / p.maxLife,
          life: p.life + 1,
        }))
        .filter(p => p.life < p.maxLife);

      // 4. Update lasers
      lasersRef.current = lasersRef.current.filter(l => currentTime - l.createdAt < 220);

      // 5. Update timers
      timeSurvivedRef.current += dt;
      if (modeRef.current === 'timeattack') {
        timeLeftRef.current = Math.max(0, timeLeftRef.current - dt);
        const intTime = Math.ceil(timeLeftRef.current);
        setTimeLeft(prev => prev !== intTime ? intTime : prev);

        if (timeLeftRef.current <= 0) {
          sounds.playLevelUp();
          cancelAnimationFrame(animId);
          statsRef.current.timeSurvivedSeconds = 60;
          statsRef.current.level = levelRef.current;
          onGameOverRef.current(statsRef.current);
          return;
        }
      }

      // 6. Schedule smooth 60fps render
      setRenderTick(t => (t + 1) & 0xffff);

      animId = requestAnimationFrame(loop);
    };

    animationFrameId.current = animId;
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [difficulty, mode, category, includeTan, spawnItem, createExplosion]);

  // Current primary targeted item
  const primaryTarget = fallingItemsRef.current.find(i => i.id === targetedItemId);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[220px] bg-slate-950 rounded-2xl border border-slate-800/90 overflow-hidden shadow-2xl transition-transform flex flex-col mx-auto ${
        screenShake ? 'translate-x-1 -translate-y-1' : ''
      }`}
    >
      {/* Background Starfield / Radial Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

      {/* Top HUD Bar */}
      <div className="relative z-20 flex items-center justify-between px-3 py-1.5 sm:px-4 sm:py-2 bg-slate-900/80 border-b border-slate-800 backdrop-blur-sm">
        {/* Left: Mode & HP */}
        <div className="flex items-center gap-3">
          {mode === 'survival' ? (
            <div className="flex items-center gap-1.5" title="防衛シールド / 体力">
              <span className="text-xs font-mono text-slate-400 mr-1">HP:</span>
              {Array.from({ length: maxHp }).map((_, idx) => (
                <Heart
                  key={idx}
                  className={`w-5 h-5 transition-transform duration-200 ${
                    idx < hp
                      ? 'fill-rose-500 text-rose-500 scale-100'
                      : 'fill-slate-800 text-slate-700 scale-90'
                  }`}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 font-mono">
              <span className="text-xs text-slate-400">残り時間:</span>
              <span className={`text-lg font-bold ${timeLeft <= 10 ? 'text-rose-400 animate-pulse' : 'text-amber-400'}`}>
                {Math.ceil(timeLeft)}s
              </span>
            </div>
          )}

          {/* Level indicator */}
          <div className="hidden sm:flex items-center gap-1 text-xs font-mono text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded">
            <span>LV.</span>
            <span className="font-bold text-indigo-400">{level}</span>
          </div>
        </div>

        {/* Center: Combo notification & Speed Selector */}
        <div className="flex items-center gap-3">
          {/* Speed Controller */}
          <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-950/80 px-1.5 sm:px-2 py-1 rounded-lg border border-slate-800 text-[10px] sm:text-[11px] font-mono">
            <span className="text-slate-400 hidden sm:inline mr-0.5">速度:</span>
            <button
              type="button"
              onClick={() => handleSpeedChange('very_slow')}
              className={`px-1.5 sm:px-2 py-0.5 rounded transition-colors ${
                speedSetting === 'very_slow'
                  ? 'bg-emerald-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="最遅：じっくり考えて解ける超ゆったり速度（約25秒）"
            >
              最遅
            </button>
            <button
              type="button"
              onClick={() => handleSpeedChange('slow')}
              className={`px-1.5 sm:px-2 py-0.5 rounded transition-colors ${
                speedSetting === 'slow'
                  ? 'bg-teal-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="ゆっくり：15秒かけてゆっくり落下（落ち着いて計算）"
            >
              ゆっくり(15s)
            </button>
            <button
              type="button"
              onClick={() => handleSpeedChange('normal')}
              className={`px-1.5 sm:px-2 py-0.5 rounded transition-colors ${
                speedSetting === 'normal'
                  ? 'bg-cyan-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="ふつう：10秒で落下（標準スピード）"
            >
              ふつう(10s)
            </button>
            <button
              type="button"
              onClick={() => handleSpeedChange('fast')}
              className={`px-1.5 sm:px-2 py-0.5 rounded transition-colors ${
                speedSetting === 'fast'
                  ? 'bg-rose-600 text-white font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="速い：6秒で落下（ハイスピード）"
            >
              速い(6s)
            </button>
          </div>

          {combo > 1 && (
            <div className="flex items-center gap-1 font-mono text-xs md:text-sm font-extrabold text-amber-400 animate-bounce">
              <Flame className="w-4 h-4 fill-amber-400 text-amber-500" />
              <span>{combo} COMBO!</span>
            </div>
          )}
          {healNotification && (
            <span className="text-xs font-bold text-emerald-400 bg-emerald-950/80 border border-emerald-800 px-2 py-0.5 rounded animate-pulse">
              +1 HP 回復!
            </span>
          )}
        </div>

        {/* Right: Score, Cheat Sheet & Surrender */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="text-right font-mono">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">SCORE</span>
            <span className="text-base md:text-xl font-extrabold text-white tabular-nums tracking-tight">
              {score.toLocaleString()}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowTrigTable(true)}
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1 text-xs font-mono text-cyan-300 hover:text-white bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-800/80 rounded transition-colors"
            title="三角比早見表を開く（ゲーム一時停止）"
          >
            <Table className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">早見表</span>
          </button>

          <button
            onClick={onQuit}
            className="px-2 sm:px-2.5 py-1 text-xs font-mono text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
          >
            終了
          </button>
        </div>
      </div>

      {/* Miss / Explanation notification banner */}
      {missNotification && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-30 max-w-md w-[92%] bg-rose-950/95 border border-rose-600/80 rounded-xl p-2.5 sm:p-3 shadow-2xl backdrop-blur-md animate-in fade-in duration-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold text-white flex items-center gap-2 mb-1 flex-wrap">
                <span className="shrink-0">防衛ライン突破!</span>
                <div className="inline-flex items-center gap-1.5 font-mono text-xs sm:text-sm bg-rose-900/60 px-2 py-0.5 rounded border border-rose-700/60">
                  <TrigExpression
                    func={missNotification.problem.func}
                    angleRad={missNotification.problem.angleRad}
                    angleDegree={missNotification.problem.angleDegree}
                    givenValueDisplay={missNotification.problem.givenValueDisplay}
                    problemType={missNotification.problem.problemType}
                    size="sm"
                  />
                  <span className="text-rose-300 font-bold">➔</span>
                  <span className="font-bold text-emerald-300">
                    <MathValueDisplay label={missNotification.problem.correctDisplay} size="sm" />
                  </span>
                </div>
              </div>
              <FormattedMathText
                text={missNotification.problem.explanation}
                className="text-rose-200/90 text-[11px] leading-tight block"
                fractionSize="xs"
              />
            </div>
          </div>
        </div>
      )}

      {/* Falling Items Area - Strictly One At A Time */}
      <div className="relative w-full flex-1 min-h-0 pointer-events-none overflow-hidden">
        {/* Breather transition message between questions */}
        {isWaitingNext && fallingItemsRef.current.length === 0 && (
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center text-xs font-mono text-indigo-300 animate-pulse bg-indigo-950/60 border border-indigo-800/60 px-4 py-2 rounded-xl backdrop-blur-xs">
            次の問題 準備中...
          </div>
        )}

        {fallingItemsRef.current.map(item => {
          const isSin = item.problem.func === 'sin' || item.problem.func === 'inv_sin';
          const isCos = item.problem.func === 'cos' || item.problem.func === 'inv_cos';
          const isTan = item.problem.func === 'tan' || item.problem.func === 'inv_tan';

          // Progress percentage towards defense line (0% to 100%)
          const progressPercent = Math.min(100, Math.max(0, ((item.yPercent - SPAWN_Y) / (DEFENSE_LINE_Y - SPAWN_Y)) * 100));

          const themeBorder = isSin
            ? 'border-emerald-400 ring-4 ring-emerald-500/35 shadow-[0_0_35px_rgba(16,185,129,0.55)]'
            : isCos
            ? 'border-cyan-400 ring-4 ring-cyan-500/35 shadow-[0_0_35px_rgba(6,182,212,0.55)]'
            : isTan
            ? 'border-amber-400 ring-4 ring-amber-500/35 shadow-[0_0_35px_rgba(245,158,11,0.55)]'
            : 'border-indigo-400 ring-4 ring-indigo-500/35 shadow-[0_0_35px_rgba(99,102,241,0.55)]';

          const themeHeaderBg = isSin
            ? 'bg-emerald-950/95 text-emerald-300 border-emerald-500/60'
            : isCos
            ? 'bg-cyan-950/95 text-cyan-300 border-cyan-500/60'
            : isTan
            ? 'bg-amber-950/95 text-amber-300 border-amber-500/60'
            : 'bg-indigo-950/95 text-indigo-300 border-indigo-500/60';

          return (
            <div
              key={item.id}
              style={{
                left: `${item.xPercent}%`,
                top: `${item.yPercent}%`,
                transform: 'translate(-50%, -50%)',
              }}
              className={`absolute flex flex-col items-center transition-all select-none ${
                item.hitState === 'wrong' ? 'animate-bounce text-rose-400' : ''
              }`}
            >
              {/* Target Type Pill above the capsule */}
              <div className={`px-3 py-1 rounded-full text-[10px] sm:text-xs font-mono font-extrabold uppercase tracking-wider border shadow-lg flex items-center gap-1.5 mb-2 ${themeHeaderBg}`}>
                <Target className="w-3.5 h-3.5 animate-pulse" />
                <span>
                  {item.problem.problemType === 'inverse_to_deg'
                    ? '度数法 [ ° ] で答えよ'
                    : item.problem.func === 'rad'
                    ? '度数法 [ ° ] に変換'
                    : `${item.problem.func.toUpperCase()} の値を答えよ`}
                </span>
              </div>

              {/* Problem Capsule - Large, Vibrant, High-Contrast */}
              <div
                className={`relative px-5 py-3 sm:px-7 sm:py-3.5 rounded-2xl border-2 flex items-center justify-center gap-3 sm:gap-4 bg-slate-900/98 backdrop-blur-md ${themeBorder}`}
              >
                <TrigExpression
                  func={item.problem.func}
                  angleRad={item.problem.angleRad}
                  angleDegree={item.problem.angleDegree}
                  givenValueDisplay={item.problem.givenValueDisplay}
                  domainHint={item.problem.domainHint}
                  problemType={item.problem.problemType}
                  size="xl"
                />

                {/* Subtitle / Quadrant / Angle Badge */}
                <div className="text-xs font-mono text-slate-200 flex flex-col items-center leading-tight border-l border-slate-700/80 pl-3">
                  <span className="font-extrabold text-white text-xs sm:text-sm">
                    {item.problem.problemType === 'inverse_to_deg'
                      ? '度数法'
                      : item.problem.func === 'rad'
                      ? '弧度法'
                      : `${item.problem.angleDegree}°`}
                  </span>
                  <span className="text-[10px] text-slate-400 mt-0.5 bg-slate-800/80 px-1.5 py-0.5 rounded">
                    {item.problem.quadrant === 'axis' ? '軸上の角' : `第${item.problem.quadrant}象限`}
                  </span>
                </div>
              </div>

              {/* Approach Progress Bar (Time Remaining indicator) */}
              <div className="w-36 sm:w-48 h-2 bg-slate-950 rounded-full mt-2.5 overflow-hidden border border-slate-700/90 shadow-inner">
                <div
                  className={`h-full transition-all duration-100 ${
                    progressPercent > 75 ? 'bg-rose-500 animate-pulse' : progressPercent > 50 ? 'bg-amber-400' : 'bg-cyan-400'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Descent trail glow */}
              <div
                className={`w-2 h-10 -mt-0.5 opacity-90 blur-[1px] rounded-b-full ${
                  isSin ? 'bg-emerald-400' : isCos ? 'bg-cyan-400' : isTan ? 'bg-amber-400' : 'bg-indigo-400'
                }`}
              />
            </div>
          );
        })}

        {/* Lasers */}
        {lasersRef.current.map(laser => (
          <svg key={laser.id} className="absolute inset-0 w-full h-full pointer-events-none">
            <line
              x1={`${laser.startX}%`}
              y1={`${laser.startY}%`}
              x2={`${laser.targetX}%`}
              y2={`${laser.targetY}%`}
              stroke={laser.color}
              strokeWidth="4"
              strokeLinecap="round"
              className="animate-pulse"
            />
          </svg>
        ))}

        {/* Explosion Particles */}
        {particlesRef.current.map(p => (
          <div
            key={p.id}
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              backgroundColor: p.color,
              opacity: p.alpha,
              transform: 'translate(-50%, -50%)',
            }}
            className="absolute rounded-full pointer-events-none shadow-[0_0_8px_currentColor]"
          />
        ))}

        {/* Defense Barrier Line - Lowered for maximum vertical drop room */}
        <div
          style={{ top: `${DEFENSE_LINE_Y}%` }}
          className="absolute left-0 right-0 border-t-2 border-dashed border-rose-500/70 flex items-center justify-between px-3 sm:px-4 text-[10px] sm:text-xs font-mono text-rose-300 pointer-events-none select-none -translate-y-1/2 z-10"
        >
          <span className="bg-slate-950/90 px-2 sm:px-2.5 py-0.5 rounded border border-rose-900/80 flex items-center gap-1.5 shadow backdrop-blur-xs">
            <Shield className="w-3.5 h-3.5 text-rose-400" /> 防衛ライン
          </span>
          <span className="bg-slate-950/90 px-2 sm:px-2.5 py-0.5 rounded border border-rose-900/80 shadow backdrop-blur-xs">
            到達でダメージ (-1 HP)
          </span>
        </div>

        {/* Bottom Defense Battery / Cannon */}
        <div className="absolute bottom-1 sm:bottom-1.5 left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-10">
          <div className="relative">
            <div className="w-12 h-6 bg-gradient-to-t from-indigo-600 to-indigo-400 rounded-t-full shadow-[0_0_20px_rgba(99,102,241,0.6)] flex items-center justify-center">
              <Zap className="w-4 h-4 text-white animate-pulse" />
            </div>
          </div>
          <div className="w-24 h-1.5 bg-slate-800 rounded-full border border-slate-700" />
        </div>
      </div>

      {/* Trigonometric Quick Reference Table Modal */}
      <TrigTableModal isOpen={showTrigTable} onClose={() => setShowTrigTable(false)} />
    </div>
  );
};
