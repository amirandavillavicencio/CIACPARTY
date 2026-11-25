const TOTAL_QUESTIONS = 10;
const DEFAULT_TIMER_SECONDS = 20;
const CHARACTER_ROSTER = [
  { id: "mario", label: "MARIO", mushroomTex: "32mt001_DEF", color: "#D91C1C" },
  { id: "luigi", label: "LUIGI", mushroomTex: "32mt002_DEF", color: "#2838B8" },
  { id: "yoshi", label: "YOSHI", mushroomTex: "32mt004_DEF", color: "#50B820" },
  { id: "wario", label: "WARIO", mushroomTex: "32mt003_DEF", color: "#E2BD18" },
  { id: "dk", label: "D. KONG", mushroomTex: "32mt005_DEF", color: "#78B5E0" },
  { id: "peach", label: "PEACH", mushroomTex: "32mt006_DEF", color: "#DD5878" },
];


export function initialState() {
  return {phase:"LOBBY", currentQuestionIndex:0, totalQuestions:TOTAL_QUESTIONS, questions:[], teams:[], lastEventBanner:"SALA DE ESPERA — ESCANEA EL CÓDIGO QR CON TU TELÉFONO", roundSeq:1, sfxCue:"NONE", sfxSeq:0, timerDurationSec:20, timerEndsAt:null};
}
function emitSfx(gameState, cue) { gameState.sfxCue=cue; gameState.sfxSeq++; }
function getRemainingSeconds(gameState) {
  if (gameState.phase !== "QUESTION_OPEN" || !gameState.timerEndsAt) {
    return 0;
  }
  return Math.max(0, Math.ceil((gameState.timerEndsAt - Date.now()) / 1000));
}

function getPublicState(gameState, origin) {
  const joinUrl = new URL("/play", origin).href;
  const currentQ = gameState.phase === "LOBBY" ? null : gameState.questions[gameState.currentQuestionIndex] || null;

  // Ordenar ranking por altura descendente (ningún equipo queda eliminado)
  const leaderboard = [...gameState.teams]
    .sort((a, b) => b.height - a.height || b.correctCount - a.correctCount)
    .map((t, idx) => ({
      rank: idx + 1,
      id: t.id,
      name: t.name,
      characterId: t.characterId,
      characterLabel: t.characterLabel,
      color: t.color,
      mushroomTex: t.mushroomTex,
      height: t.height,
      correctCount: t.correctCount,
      wrongCount: t.wrongCount,
      streak: t.streak || 0,
      answered: Boolean(t.currentAnswer),
      currentAnswer:
        gameState.phase === "QUESTION_REVEALED" || gameState.phase === "FINISHED"
          ? t.currentAnswer
          : null,
      lastDelta: t.lastDelta,
    }));

  const maxH = gameState.teams.length
    ? Math.max(...gameState.teams.map((t) => t.height))
    : 0;
  const winners =
    gameState.phase === "FINISHED"
      ? gameState.teams.filter((t) => t.height === maxH)
      : [];

  return {
    phase: gameState.phase,
    bankReady: gameState.questions.length === TOTAL_QUESTIONS,
    currentQuestionIndex: gameState.currentQuestionIndex,
    questionNumber: gameState.currentQuestionIndex + 1,
    totalQuestions: gameState.totalQuestions,
    remainingSeconds: getRemainingSeconds(gameState),
    timerDurationSec: gameState.timerDurationSec,
    timerEndsAt: gameState.timerEndsAt,
    serverNow: Date.now(),
    currentQuestion: currentQ
      ? {
          number: currentQ.number,
          code: currentQ.code,
          prompt: currentQ.prompt,
          options: currentQ.options,
          correctOption:
            gameState.phase === "QUESTION_REVEALED" || gameState.phase === "FINISHED"
              ? currentQ.correctOption
              : null,
        }
      : null,
    teams: gameState.teams.map((t) => ({
      id: t.id,
      name: t.name,
      characterId: t.characterId,
      characterLabel: t.characterLabel,
      color: t.color,
      mushroomTex: t.mushroomTex,
      height: t.height,
      correctCount: t.correctCount,
      wrongCount: t.wrongCount,
      streak: t.streak || 0,
      answered: Boolean(t.currentAnswer),
      currentAnswer:
        gameState.phase === "QUESTION_REVEALED" || gameState.phase === "FINISHED"
          ? t.currentAnswer
          : null,
      lastDelta: t.lastDelta,
    })),
    leaderboard,
    winners: winners.map((w) => ({
      id: w.id,
      name: w.name,
      characterId: w.characterId,
      characterLabel: w.characterLabel,
      height: w.height,
      color: w.color,
      correctCount: w.correctCount,
    })),
    roster: CHARACTER_ROSTER,
    joinUrl,
    lastEventBanner: gameState.lastEventBanner,
    roundSeq: gameState.roundSeq,
    sfxCue: gameState.sfxCue,
    sfxSeq: gameState.sfxSeq,
  };
}


function startQuestionRound(gameState, qIndex) {
  gameState.currentQuestionIndex = qIndex;
  gameState.phase = "QUESTION_OPEN";
  gameState.roundSeq += 1;
  gameState.timerEndsAt = Date.now() + gameState.timerDurationSec * 1000;
  for (const t of gameState.teams) {
    t.currentAnswer = null;
    t.answeredAt = null;
    t.lastDelta = 0;
  }
  emitSfx(gameState, "START");
  gameState.lastEventBanner = `PREGUNTA ${qIndex + 1} DE ${gameState.totalQuestions} — ¡ELIJAN A, B, C o D!`;
}

function evaluateCurrentQuestion(gameState) {
  if (gameState.phase !== "QUESTION_OPEN") return;
  const q = gameState.questions[gameState.currentQuestionIndex];
  const correctOpt = q ? q.correctOption : "A";
  let upCount = 0;
  let downCount = 0;

  for (const t of gameState.teams) {
    if (t.currentAnswer === correctOpt) {
      t.height += 1;
      t.correctCount += 1;
      t.streak = (t.streak || 0) + 1;
      t.lastDelta = 1;
      upCount += 1;
    } else {
      // Respuesta incorrecta o sin responder baja la plataforma 1 nivel (ningún equipo es eliminado)
      t.height -= 1;
      t.wrongCount += 1;
      t.streak = 0;
      t.lastDelta = -1;
      downCount += 1;
    }
  }

  gameState.phase = "QUESTION_REVEALED";
  gameState.timerEndsAt = null;
  gameState.roundSeq += 1;
  emitSfx(gameState, upCount > 0 ? "UP" : "DOWN");
  gameState.lastEventBanner = `CLAVE [${correctOpt}] — ↑ ${upCount} SUBEN (+1m) | ↓ ${downCount} BAJAN (-1m)`;
}


const keys = ["A","B","C","D"];
function normalizeQuestions(input) {
  if (!Array.isArray(input) || input.length !== TOTAL_QUESTIONS) throw new Error("Se requieren exactamente 10 preguntas.");
  return input.map((q,i) => {
    if (!q || typeof q.prompt !== "string" || !q.prompt.trim() || q.prompt.length>500 || /PENDIENTE DE BANCO OFICIAL|ESPACIO PARA PREGUNTA/i.test(q.prompt) || !Array.isArray(q.options) || q.options.length!==4 || !keys.includes(q.correctOption)) throw new Error(`Pregunta ${i+1} incompleta o inválida.`);
    const options=q.options.map((o,j)=>{ const label=typeof o==="string"?o:o?.label; if(typeof label!=="string"||!label.trim()||label.length>250||/^OPCIÓN [ABCD]$/i.test(label.trim())) throw new Error(`Alternativa ${keys[j]} de la pregunta ${i+1} inválida.`); return {key:keys[j],label:label.trim()}; });
    if(new Set(options.map(o=>o.label.toLocaleLowerCase())).size!==4) throw new Error(`Alternativas repetidas en pregunta ${i+1}.`);
    return {number:i+1,code:`PREGUNTA ${String(i+1).padStart(2,"0")} / ${TOTAL_QUESTIONS}`,prompt:q.prompt.trim(),options,correctOption:q.correctOption};
  });
}
const fail=(status,error)=>({status,data:{error},changed:false});
const ok=(data,changed=false)=>({status:200,data,changed});
async function authorized(secret, supplied) {
  if(typeof secret!=="string"||secret.length<16||typeof supplied!=="string"||supplied.length>512) return false;
  const enc=new TextEncoder();
  const a=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(secret))), b=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(supplied)));
  let d=0; for(let i=0;i<a.length;i++)d|=a[i]^b[i]; return d===0;
}
export async function handleGame(state, {method, path, origin, auth, body={}}, secret) {
  if(state.phase==="LOBBY"&&state.questions.length===0)state.totalQuestions=TOTAL_QUESTIONS;
  const pub=()=>getPublicState(state,origin);
  if(method==="GET" && path==="/api/state")return ok(pub());
  if(path==="/api/questions"||path==="/api/host/action"||path==="/api/host/check") {
    if(!await authorized(secret,auth))return fail(401,"ACCESO EXCLUSIVO DEL ANFITRIÓN");
    if(method==="GET"&&path==="/api/host/check")return ok({ok:true});
    if(method==="GET"&&path==="/api/questions")return ok({totalQuestions:TOTAL_QUESTIONS,questions:state.questions});
    if(method!=="POST"||path!=="/api/host/action")return fail(405,"Método no permitido");
    const action=body.action;
    if(action==="LOAD_QUESTIONS") {
      if(state.phase!=="LOBBY")return fail(409,"Edita el banco en la sala de espera.");
      try {state.questions=normalizeQuestions(body.questions);state.totalQuestions=TOTAL_QUESTIONS;} catch(e){return fail(400,e.message);}
      state.lastEventBanner="BANCO DE 10 PREGUNTAS CARGADO";
    } else if(action==="START_GAME") {
      if(state.phase!=="LOBBY"||state.questions.length!==TOTAL_QUESTIONS||!state.teams.length)return fail(409,"Se necesitan 10 preguntas, equipos y estar en la sala de espera.");
      startQuestionRound(state,0);
    } else if(action==="REVEAL_AND_MOVE") {
      if(state.phase!=="QUESTION_OPEN")return fail(409,"No hay una pregunta abierta.");
      evaluateCurrentQuestion(state);
    } else if(action==="NEXT_QUESTION") {
      if(state.phase!=="QUESTION_REVEALED")return fail(409,"Evalúa primero la pregunta actual.");
      if(state.currentQuestionIndex<TOTAL_QUESTIONS-1)startQuestionRound(state,state.currentQuestionIndex+1);
      else {state.phase="FINISHED";state.timerEndsAt=null;state.roundSeq++;emitSfx(state,"FANFARE");state.lastEventBanner="¡FIN DE LAS 10 PREGUNTAS!";}
    } else if(action==="RESET_HEIGHTS"||action==="CLEAR_TEAMS") {
      if(action==="CLEAR_TEAMS")state.teams=[];
      for(const t of state.teams)Object.assign(t,{height:0,correctCount:0,wrongCount:0,streak:0,currentAnswer:null,answeredAt:null,lastDelta:0});
      state.phase="LOBBY";state.currentQuestionIndex=0;state.timerEndsAt=null;state.roundSeq++;state.lastEventBanner="SALA DE ESPERA — ESCANEA EL CÓDIGO QR CON TU TELÉFONO";
    } else if(action==="SET_TIMER_DURATION") {
      if(state.phase!=="LOBBY")return fail(409,"Configura el tiempo antes de iniciar.");
      if(!Number.isInteger(body.seconds)||body.seconds<5||body.seconds>120)return fail(400,"Tiempo inválido");state.timerDurationSec=body.seconds;
    } else return fail(400,"Acción no permitida");
    return ok(pub(),true);
  }
  if(method==="POST"&&path==="/api/join") {
    let team=state.teams.find(t=>t.id===body.teamId&&t.token===body.teamToken);
    if(team)return ok({team:{id:team.id,name:team.name,characterId:team.characterId,token:team.token},state:pub()});
    if(state.phase!=="LOBBY")return fail(409,"La partida ya comenzó.");
    const name=String(body.name||"").trim().toUpperCase().slice(0,14);
    if(!name||!(/^[\p{L}\p{N} ._!&-]+$/u.test(name)))return fail(400,"Nombre de equipo inválido");
    if(state.teams.some(t=>t.name===name))return fail(409,"Ese nombre ya está registrado.");
    if(state.teams.length>=6)return fail(409,"Los seis equipos ya están registrados.");
    const free=CHARACTER_ROSTER.filter(c=>!state.teams.some(t=>t.characterId===c.id));
    const c=free.find(c=>c.id===body.characterId)||free[0];
    team={id:crypto.randomUUID(),token:crypto.randomUUID(),name,characterId:c.id,characterLabel:c.label,color:c.color,mushroomTex:c.mushroomTex,height:0,correctCount:0,wrongCount:0,streak:0,currentAnswer:null,answeredAt:null,lastDelta:0};
    state.teams.push(team);emitSfx(state,"ANSWER");state.lastEventBanner=`¡${name} (${c.label}) SUBIÓ A SU PLATAFORMA!`;
    return ok({team:{id:team.id,name,characterId:team.characterId,token:team.token},state:pub()},true);
  }
  if(method==="POST"&&path==="/api/answer") {
    const t=state.teams.find(t=>t.id===body.teamId&&t.token===body.teamToken);
    if(!t)return fail(403,"Equipo no autorizado");
    if(state.phase!=="QUESTION_OPEN"||Date.now()>=state.timerEndsAt||body.roundSeq!==state.roundSeq)return fail(409,"LA PREGUNTA YA ESTÁ CERRADA");
    if(!keys.includes(body.option))return fail(400,"OPCIÓN INVÁLIDA");
    t.currentAnswer=body.option;t.answeredAt=Date.now();emitSfx(state,"ANSWER");state.lastEventBanner=`${t.name} RESPONDIÓ (${state.teams.filter(t=>t.currentAnswer).length}/${state.teams.length} LISTOS)`;
    return ok({ok:true,answer:body.option,state:pub()},true);
  }
  return fail(404,"Ruta no encontrada");
}
