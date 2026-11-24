import express from "express";
import cors from "cors";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ["GET", "POST"] } });
const PORT = process.env.PORT || 3001;
const rooms = new Map();
const COLORS = ["red", "yellow", "green", "blue"];
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function id(n=8) { return crypto.randomBytes(n).toString("hex"); }
function roomCode() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function makeDeck() {
  const deck = [];
  for (const color of COLORS) {
    deck.push({ id: id(), color, value: "0" });
    for (let v=1; v<=9; v++) {
      deck.push({ id: id(), color, value: String(v) });
      deck.push({ id: id(), color, value: String(v) });
    }
    for (const value of ["skip", "reverse", "draw2"]) {
      deck.push({ id: id(), color, value });
      deck.push({ id: id(), color, value });
    }
  }
  for (let i=0; i<4; i++) {
    deck.push({ id: id(), color: "wild", value: "wild" });
    deck.push({ id: id(), color: "wild", value: "wild4" });
  }
  return deck;
}
function shuffle(a) {
  for (let i=a.length-1; i>0; i--) {
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function playable(card, top, activeColor) {
  return card.color === "wild" || card.color === activeColor || card.value === top.value;
}
function currentPlayer(room) { return room.players[room.turnIndex]; }
function nextIndex(room, from=room.turnIndex, steps=1) {
  let idx=from;
  for(let i=0;i<steps;i++) idx=(idx+room.direction+room.players.length)%room.players.length;
  return idx;
}
function drawCards(room, player, count) {
  const got=[];
  for(let i=0;i<count;i++) {
    if (!room.drawPile.length) {
      if (room.discardPile.length <= 1) break;
      const top=room.discardPile.pop();
      room.drawPile=shuffle(room.discardPile.splice(0));
      room.discardPile=[top];
    }
    if (!room.drawPile.length) break;
    const c=room.drawPile.pop();
    player.hand.push(c); got.push(c);
  }
  return got;
}
function publicState(room, viewerId) {
  const me=room.players.find(p=>p.id===viewerId);
  return {
    code: room.code, status: room.status, hostId: room.hostId,
    players: room.players.map(p=>({ id:p.id, name:p.name, connected:p.connected, cardCount:p.hand.length, isHost:p.id===room.hostId })),
    turnPlayerId: room.status==="playing" ? currentPlayer(room)?.id : null,
    direction: room.direction,
    topCard: room.discardPile.at(-1) || null,
    activeColor: room.activeColor,
    drawCount: room.drawPile.length,
    discardCount: room.discardPile.length,
    myHand: me ? me.hand : [],
    myDrawnCardId: me ? (me.drawnCardId || null) : null,
    myId: viewerId,
    pendingDraw: room.pendingDraw || null,
    pendingChallenge: room.pendingChallenge ? {
      offenderId: room.pendingChallenge.offenderId,
      challengerId: room.pendingChallenge.challengerId,
      color: room.pendingChallenge.color
    } : null,
    pendingOpeningWild: room.pendingOpeningWild || null,
    pendingUno: room.pendingUno ? { playerId: room.pendingUno.playerId } : null,
    winnerId: room.winnerId || null,
    lastAction: room.lastAction || "Room created",
    rules: "official-classic"
  };
}
function emitRoom(room) {
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit("state", publicState(room,p.id));
  }
}
function message(room, text) {
  room.lastAction=text;
  emitRoom(room);
}
function fail(socket, msg) { socket.emit("gameError", msg); }
function getPlayer(room, pid) { return room.players.find(p=>p.id===pid); }
function active(room, player) {
  if (room.status!=="playing") throw new Error("The game is not in progress.");
  if (currentPlayer(room)?.id!==player.id) throw new Error("It is not your turn.");
}
function clearUnoOnNextAction(room, actorId) {
  if (room.pendingUno && room.pendingUno.playerId !== actorId) room.pendingUno=null;
}
function advance(room, steps=1) {
  room.turnIndex=nextIndex(room,room.turnIndex,steps);
}
function finishIfWon(room, player) {
  if (player.hand.length===0) {
    room.status="finished";
    room.winnerId=player.id;
    room.pendingChallenge=null;
    room.pendingDraw=null;
    room.pendingUno=null;
    room.lastAction=`${player.name} wins the round!`;
    return true;
  }
  return false;
}
function requireColor(color) {
  if (!COLORS.includes(color)) throw new Error("Choose red, yellow, green or blue.");
}
function applyCard(room, player, cardId, chosenColor=null) {
  const idx=player.hand.findIndex(c=>c.id===cardId);
  if(idx<0) throw new Error("That card is not in your hand.");
  const card=player.hand[idx];
  const top=room.discardPile.at(-1);
  const previousColor=room.activeColor;
  if(player.drawnCardId && player.drawnCardId!==card.id) throw new Error("After drawing, you may only play the card you just drew.");
  if(!playable(card,top,previousColor)) throw new Error("That card does not match the active colour or symbol.");
  if(card.value==="wild" || card.value==="wild4") requireColor(chosenColor);
  const hadMatchingColor=card.value==="wild4" ? player.hand.some(c=>c.id!==card.id && c.color===previousColor) : false;
  player.hand.splice(idx,1);
  player.drawnCardId=null;
  room.discardPile.push(card);
  room.activeColor=(card.color==="wild") ? chosenColor : card.color;
  room.pendingUno=player.hand.length===1 ? { playerId:player.id } : null;

  if(finishIfWon(room,player)) return;

  const n=room.players.length;
  if(card.value==="skip") {
    advance(room,2);
    room.lastAction=`${player.name} played Skip. The next player loses their turn.`;
  } else if(card.value==="reverse") {
    room.direction*=-1;
    if(n===2) advance(room,2); else advance(room,1);
    room.lastAction=`${player.name} played Reverse. Direction changed.`;
  } else if(card.value==="draw2") {
    advance(room,1);
    room.pendingDraw={ targetId:currentPlayer(room).id, count:2 };
    room.lastAction=`${player.name} played Draw Two. ${currentPlayer(room).name} must draw 2 and miss a turn.`;
  } else if(card.value==="wild4") {
    advance(room,1);
    room.pendingChallenge={ offenderId:player.id, challengerId:currentPlayer(room).id, color:previousColor, hadMatchingColor };
    room.lastAction=`${player.name} played Wild Draw Four. ${currentPlayer(room).name} may challenge or accept.`;
  } else if(card.value==="wild") {
    advance(room,1);
    room.lastAction=`${player.name} chose ${room.activeColor}.`;
  } else {
    advance(room,1);
    room.lastAction=`${player.name} played ${card.color} ${card.value}.`;
  }
}
function startGame(room) {
  if(room.players.length<2) throw new Error("At least 2 players are required.");
  if(room.players.length>10) throw new Error("A room can have at most 10 players.");
  room.status="playing"; room.direction=1; room.turnIndex=0;
  room.drawPile=shuffle(makeDeck()); room.discardPile=[];
  room.players.forEach(p=>{p.hand=[];p.drawnCardId=null;});
  for(let i=0;i<7;i++) for(const p of room.players) p.hand.push(room.drawPile.pop());
  // Flip the opening card and apply the classic opening-card instructions.
  let first=room.drawPile.pop();
  while(first.value==="wild4") {
    room.drawPile.unshift(first);
    shuffle(room.drawPile);
    first=room.drawPile.pop();
  }
  room.discardPile.push(first);
  room.activeColor=first.color==="wild" ? null : first.color;
  room.pendingDraw=null; room.pendingChallenge=null; room.pendingOpeningWild=null; room.pendingUno=null; room.winnerId=null;
  if(first.value==="reverse") {
    room.direction=-1;
    room.turnIndex=0;
    room.lastAction=`Opening Reverse. Direction is reversed; ${room.players[0].name} plays first.`;
  } else if(first.value==="skip") {
    room.turnIndex=1 % room.players.length;
    room.lastAction=`Opening Skip. ${room.players[0].name} is skipped.`;
  } else if(first.value==="draw2") {
    drawCards(room,room.players[0],2);
    room.turnIndex=1 % room.players.length;
    room.lastAction=`Opening Draw Two. ${room.players[0].name} draws 2 and is skipped.`;
  } else if(first.value==="wild") {
    room.turnIndex=0;
    room.pendingOpeningWild={chooserId:room.players[0].id};
    room.lastAction=`Opening Wild. ${room.players[0].name} chooses the starting colour.`;
  } else {
    room.turnIndex=0;
    room.lastAction=`Game started. ${room.players[0].name} goes first.`;
  }
}
function connectPlayer(socket, room, player) {
  player.socketId=socket.id; player.connected=true;
  socket.data.roomCode=room.code; socket.data.playerId=player.id;
  socket.join(room.code);
  emitRoom(room);
}

app.get("/health",(_,res)=>res.json({ok:true,app:"OKKA"}));
app.get("/api/room/:code",(req,res)=>{
  const r=rooms.get(req.params.code.toUpperCase());
  if(!r) return res.status(404).json({error:"Room not found"});
  res.json({code:r.code,status:r.status,players:r.players.length});
});

io.on("connection", socket=>{
  socket.on("createRoom", ({name}, cb=()=>{})=>{
    try {
      const clean=String(name||"").trim().slice(0,18);
      if(!clean) throw new Error("Enter a display name.");
      let code=roomCode(); while(rooms.has(code)) code=roomCode();
      const player={id:id(12),name:clean,hand:[],connected:true,socketId:socket.id};
      const room={code,hostId:player.id,players:[player],status:"lobby",drawPile:[],discardPile:[],turnIndex:0,direction:1,activeColor:null,pendingDraw:null,pendingChallenge:null,pendingUno:null,winnerId:null,lastAction:"Room created"};
      rooms.set(code,room); connectPlayer(socket,room,player);
      cb({ok:true,code,playerId:player.id,token:player.id});
    } catch(e){ cb({ok:false,error:e.message}); }
  });
  socket.on("joinRoom", ({code,name,token}, cb=()=>{})=>{
    try {
      const room=rooms.get(String(code||"").toUpperCase());
      if(!room) throw new Error("Room not found. Check the invitation link.");
      let player=token ? getPlayer(room,token) : null;
      if(player) {
        if(player.socketId && player.socketId!==socket.id) io.to(player.socketId).emit("sessionReplaced");
        player.name=String(name||player.name).trim().slice(0,18)||player.name;
      } else {
        if(room.status!=="lobby") throw new Error("This game has already started. Rejoin with your original session.");
        if(room.players.length>=10) throw new Error("This room is full (10 players maximum).");
        const clean=String(name||"").trim().slice(0,18);
        if(!clean) throw new Error("Enter a display name.");
        player={id:id(12),name:clean,hand:[],connected:true,socketId:socket.id};
        room.players.push(player);
      }
      connectPlayer(socket,room,player);
      cb({ok:true,code:room.code,playerId:player.id,token:player.id});
      message(room,`${player.name} joined the room.`);
    } catch(e){ cb({ok:false,error:e.message}); }
  });
  socket.on("chooseOpeningColor",({color})=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    try {
      const p=getPlayer(room,socket.data.playerId);
      if(!room.pendingOpeningWild || room.pendingOpeningWild.chooserId!==p.id || currentPlayer(room).id!==p.id) throw new Error("You cannot choose the opening colour.");
      requireColor(color);
      room.activeColor=color; room.pendingOpeningWild=null;
      room.lastAction=`${p.name} chose ${color} to start the game.`;
      emitRoom(room);
    } catch(e){ fail(socket,e.message); }
  });
  socket.on("startGame",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    try {
      if(socket.data.playerId!==room.hostId) throw new Error("Only the host can start the game.");
      if(room.status!=="lobby") throw new Error("The game has already started.");
      startGame(room); emitRoom(room);
    } catch(e){ fail(socket,e.message); }
  });
  socket.on("playCard",({cardId,color})=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    try {
      const p=getPlayer(room,socket.data.playerId); active(room,p);
      if(room.pendingChallenge) throw new Error("Resolve the Wild Draw Four challenge first.");
      if(room.pendingOpeningWild) throw new Error("Choose the opening colour first.");
      if(room.pendingDraw) throw new Error("You must take the Draw Two penalty.");
      clearUnoOnNextAction(room,p.id);
      applyCard(room,p,cardId,color); emitRoom(room);
    } catch(e){ fail(socket,e.message); }
  });
  socket.on("drawCard",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    try {
      const p=getPlayer(room,socket.data.playerId); active(room,p);
      if(room.pendingChallenge) throw new Error("Challenge or accept the Wild Draw Four first.");
      if(room.pendingOpeningWild) throw new Error("Choose the opening colour first.");
      if(room.pendingDraw) {
        if(room.pendingDraw.targetId!==p.id) throw new Error("This penalty is not yours.");
        clearUnoOnNextAction(room,p.id);
        const count=room.pendingDraw.count; drawCards(room,p,count); p.drawnCardId=null; room.pendingDraw=null; advance(room,1);
        room.lastAction=`${p.name} drew ${count} cards and missed their turn.`;
        emitRoom(room); return;
      }
      if(p.drawnCardId) throw new Error("You have already drawn this turn.");
      clearUnoOnNextAction(room,p.id);
      const got=drawCards(room,p,1);
      if(!got.length) throw new Error("No cards are available to draw.");
      p.drawnCardId=got[0].id;
      if(!playable(got[0],room.discardPile.at(-1),room.activeColor)) {
        p.drawnCardId=null; advance(room,1); room.lastAction=`${p.name} drew a card and passed.`;
      } else room.lastAction=`${p.name} drew a playable card and may play it or pass.`;
      emitRoom(room);
    } catch(e){ fail(socket,e.message); }
  });
  socket.on("passTurn",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    try {
      const p=getPlayer(room,socket.data.playerId); active(room,p);
      if(room.pendingDraw || room.pendingChallenge || room.pendingOpeningWild) throw new Error("Resolve the pending action first.");
      if(!p.drawnCardId) throw new Error("You can only pass after drawing a playable card.");
      p.drawnCardId=null; advance(room,1); room.lastAction=`${p.name} passed after drawing.`;
      emitRoom(room);
    } catch(e){ fail(socket,e.message); }
  });
  socket.on("challengeWild4",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    try {
      const p=getPlayer(room,socket.data.playerId);
      if(!room.pendingChallenge || room.pendingChallenge.challengerId!==p.id || currentPlayer(room).id!==p.id) throw new Error("There is no challenge available for you.");
      clearUnoOnNextAction(room,p.id);
      const c=room.pendingChallenge; const offender=getPlayer(room,c.offenderId);
      room.pendingChallenge=null;
      if(c.hadMatchingColor) {
        drawCards(room,offender,4);
        room.lastAction=`Challenge successful! ${offender.name} draws 4. ${p.name} keeps the turn.`;
        room.turnIndex=room.players.findIndex(x=>x.id===p.id);
      } else {
        drawCards(room,p,6);
        room.lastAction=`Challenge failed. ${p.name} draws 6 and loses the turn.`;
        advance(room,1);
      }
      emitRoom(room);
    } catch(e){ fail(socket,e.message); }
  });
  socket.on("acceptWild4",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    try {
      const p=getPlayer(room,socket.data.playerId);
      if(!room.pendingChallenge || room.pendingChallenge.challengerId!==p.id || currentPlayer(room).id!==p.id) throw new Error("There is no Wild Draw Four to accept.");
      clearUnoOnNextAction(room,p.id);
      drawCards(room,p,4); room.pendingChallenge=null; advance(room,1);
      room.lastAction=`${p.name} accepted Wild Draw Four and drew 4.`;
      emitRoom(room);
    } catch(e){ fail(socket,e.message); }
  });
  socket.on("callUno",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    const p=getPlayer(room,socket.data.playerId);
    if(!p || !room.pendingUno || room.pendingUno.playerId!==p.id || p.hand.length!==1) return fail(socket,"You can only call UNO when you have one card.");
    room.pendingUno=null; room.lastAction=`${p.name} called UNO!`; emitRoom(room);
  });
  socket.on("catchUno",({playerId})=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    const offender=getPlayer(room,playerId);
    if(!offender || !room.pendingUno || room.pendingUno.playerId!==playerId || offender.hand.length!==1) return fail(socket,"That player is not currently catchable.");
    if(socket.data.playerId===playerId) return fail(socket,"You cannot catch yourself.");
    drawCards(room,offender,2); room.pendingUno=null;
    room.lastAction=`${offender.name} was caught without calling UNO and draws 2 cards.`;
    emitRoom(room);
  });
  socket.on("chat",({text})=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    const p=getPlayer(room,socket.data.playerId); if(!p) return;
    const msg=String(text||"").trim().slice(0,160); if(!msg) return;
    io.to(room.code).emit("chatMessage",{name:p.name,text:msg,at:Date.now()});
  });
  socket.on("disconnect",()=>{
    const room=rooms.get(socket.data.roomCode); if(!room) return;
    const p=getPlayer(room,socket.data.playerId); if(!p) return;
    p.connected=false; p.socketId=null; message(room,`${p.name} disconnected. They can rejoin using the same browser session.`);
    // Keep room state for reconnect; empty/stale rooms are removed after 2 hours.
    setTimeout(()=>{const r=rooms.get(room.code); if(r && r.players.every(x=>!x.connected)) rooms.delete(room.code);},2*60*60*1000).unref?.();
  });
});

if(process.env.NODE_ENV==="production") {
  const clientDist=path.resolve(__dirname,"../client/dist");
  app.use(express.static(clientDist));
  app.get("*",(req,res)=>res.sendFile(path.join(clientDist,"index.html")));
}
server.listen(PORT,()=>console.log(`OKKA server listening on ${PORT}`));
