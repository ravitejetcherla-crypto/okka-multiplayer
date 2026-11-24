import React, { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { Copy, Users, Plus, LogIn, Crown, Wifi, WifiOff, ArrowLeft, MessageCircle, Send, Volume2, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";

const API = import.meta.env.VITE_SERVER_URL || window.location.origin;
const socket = io(API, { autoConnect:false, transports:["websocket","polling"] });
const COLORS=["red","yellow","green","blue"];
const labels={skip:"SKIP",reverse:"↔",draw2:"+2",wild:"WILD",wild4:"+4"};
function Card({card,small=false,disabled=false,onClick,back=false}) {
  if(back) return <div className={`card back ${small?"small":""}`}><span>OKKA</span></div>;
  return <button disabled={disabled} onClick={onClick} className={`card ${card.color} ${small?"small":""} ${disabled?"disabled":""}`}>
    <span className="card-corner">{labels[card.value]||card.value}</span>
    <strong>{labels[card.value]||card.value}</strong>
    <span className="card-corner bottom">{labels[card.value]||card.value}</span>
  </button>;
}
function App(){
  const [page,setPage]=useState("home"),[name,setName]=useState(localStorage.getItem("okka-name")||"");
  const [code,setCode]=useState(new URLSearchParams(location.search).get("room")||"");
  const [room,setRoom]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [chosen,setChosen]=useState(null),[chat,setChat]=useState(""),[messages,setMessages]=useState([]);
  const [showChat,setShowChat]=useState(false),[copied,setCopied]=useState(false);
  const tokenKey=code?`okka-token-${code.toUpperCase()}`:"";
  const myId=room?.myId;
  const isMyTurn=room?.turnPlayerId===myId;
  const me=room?.players.find(p=>p.id===myId);
  const pendingChallenge=room?.pendingChallenge?.challengerId===myId;
  const pendingDraw=room?.pendingDraw?.targetId===myId;
  const needsColor=chosen!==null;

  useEffect(()=>{
    const onState=s=>{setRoom(s);setPage(s.status==="lobby"?"lobby":"game");setError("");};
    const onError=e=>setError(e);
    const onChat=m=>setMessages(old=>[...old.slice(-49),m]);
    const onReplace=()=>{setError("This player session was opened in another tab or device.");socket.disconnect();};
    socket.on("state",onState);socket.on("gameError",onError);socket.on("chatMessage",onChat);socket.on("sessionReplaced",onReplace);
    return()=>{socket.off("state",onState);socket.off("gameError",onError);socket.off("chatMessage",onChat);socket.off("sessionReplaced",onReplace);};
  },[]);
  useEffect(()=>{
    const params=new URLSearchParams(location.search);
    if(params.get("room")) setCode(params.get("room").toUpperCase());
  },[]);
  const connect=()=>{if(!socket.connected) socket.connect();};
  const create=()=>{
    setError("");setBusy(true);localStorage.setItem("okka-name",name.trim());
    connect();socket.once("connect",()=>socket.emit("createRoom",{name},res=>{setBusy(false);if(!res.ok)return setError(res.error);setCode(res.code);localStorage.setItem(`okka-token-${res.code}`,res.token);history.replaceState({}, "", `?room=${res.code}`);}));
    if(socket.connected) socket.emit("createRoom",{name},res=>{setBusy(false);if(!res.ok)return setError(res.error);setCode(res.code);localStorage.setItem(`okka-token-${res.code}`,res.token);history.replaceState({}, "", `?room=${res.code}`);});
  };
  const join=()=>{
    setError("");setBusy(true);localStorage.setItem("okka-name",name.trim());
    const c=code.trim().toUpperCase(); if(!c){setBusy(false);return setError("Enter a room code.");}
    connect();
    const doJoin=()=>socket.emit("joinRoom",{code:c,name,token:localStorage.getItem(`okka-token-${c}`)},res=>{
      setBusy(false);if(!res.ok)return setError(res.error);
      setCode(c);localStorage.setItem(`okka-token-${c}`,res.token);history.replaceState({}, "", `?room=${c}`);
    });
    if(socket.connected) doJoin(); else socket.once("connect",doJoin);
  };
  const play=(card)=>{
    if(!isMyTurn)return;
    if(card.color==="wild"){setChosen(card.id);return;}
    socket.emit("playCard",{cardId:card.id});
  };
  const chooseColor=color=>{
    if(chosen) socket.emit("playCard",{cardId:chosen,color});
    else socket.emit("chooseOpeningColor",{color});
    setChosen(null);
  };
  const copyLink=async()=>{
    const url=`${location.origin}/?room=${room.code}`;
    try{await navigator.clipboard.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{setError(url);}
  };
  const sendChat=e=>{e.preventDefault();if(chat.trim()){socket.emit("chat",{text:chat});setChat("");}};
  const canPlay=card=>isMyTurn&&!room.pendingDraw&&!room.pendingChallenge&&(!room.myDrawnCardId||room.myDrawnCardId===card.id);
  const activePlayer=room?.players.find(p=>p.id===room.turnPlayerId);
  const colorLabel=room?.activeColor||"";
  const exit=()=>{socket.disconnect();setRoom(null);setPage("home");history.replaceState({}, "", "/");setCode("");};

  if(!room) return <main className="home">
    <div className="brand"><div className="brand-mark">O</div><span>OKKA</span><i>PLAY TOGETHER</i></div>
    <section className="hero">
      <div className="eyebrow"><Sparkles size={14}/> REAL-TIME MULTIPLAYER</div>
      <h1>One table.<br/><em>Your people.</em></h1>
      <p>Bring your friends together for a fast, fair card game. No downloads. Just share a link and play.</p>
      <div className="home-card-stack"><div className="float-card red">7</div><div className="float-card blue">↔</div><div className="float-card yellow">+2</div><div className="float-card green">3</div></div>
    </section>
    <section className="join-panel">
      <label>YOUR PLAYER NAME</label>
      <input value={name} maxLength={18} onChange={e=>setName(e.target.value)} placeholder="Enter your name" />
      <button className="primary wide" disabled={busy||!name.trim()} onClick={create}><Plus size={18}/> Create a room</button>
      <div className="or"><span/> OR JOIN FRIENDS <span/></div>
      <div className="join-row"><input value={code} maxLength={6} onChange={e=>setCode(e.target.value.toUpperCase())} placeholder="ROOM CODE" /><button className="secondary" disabled={busy||!name.trim()||!code.trim()} onClick={join}><LogIn size={17}/> Join</button></div>
      {error&&<div className="error">{error}</div>}
      <div className="fineprint"><Users size={14}/> 2–10 players · Private rooms · Free to play</div>
    </section>
    <footer>OKKA <span>•</span> A friendly card table on the internet</footer>
  </main>;

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand compact"><div className="brand-mark">O</div><span>OKKA</span></div>
      <div className="room-pill">ROOM <b>{room.code}</b></div>
      <div className="top-actions"><span className="live"><i/> LIVE</span><button className="icon-btn" onClick={()=>setShowChat(!showChat)}><MessageCircle size={18}/></button><button className="icon-btn" onClick={exit}><ArrowLeft size={18}/></button></div>
    </header>
    {room.status==="lobby"?<section className="lobby">
      <div className="lobby-head"><div className="eyebrow">PRIVATE GAME ROOM</div><h1>Waiting for your crew<span>.</span></h1><p>Share the invite link. Your friends will appear here when they join.</p></div>
      <div className="invite-box"><div><small>YOUR INVITATION LINK</small><strong>{location.origin}/?room={room.code}</strong></div><button className="primary" onClick={copyLink}><Copy size={16}/>{copied?"Copied!":"Copy link"}</button></div>
      <div className="players-heading"><h3>Players <span>{room.players.length}/10</span></h3><span>Need at least 2 to start</span></div>
      <div className="player-grid">{room.players.map((p,i)=><div className="player-tile" key={p.id}><div className={`avatar a${i%6}`}>{p.name.slice(0,1).toUpperCase()}</div><div><b>{p.name}</b><small>{p.isHost?"HOST": "PLAYER"} · {p.connected?"CONNECTED":"RECONNECTING"}</small></div>{p.isHost&&<Crown size={17} className="crown"/>}</div>)}
      {Array.from({length:Math.max(0,4-room.players.length)},(_,i)=><div className="player-tile empty" key={i}><div className="avatar">+</div><div><b>Open seat</b><small>SHARE LINK TO INVITE</small></div></div>)}</div>
      {me?.isHost?<button className="primary start-btn" disabled={room.players.length<2} onClick={()=>socket.emit("startGame")}><Sparkles size={18}/> Start game</button>:<div className="waiting-note"><span className="pulse"/> Waiting for the host to start…</div>}
      {error&&<div className="error">{error}</div>}
    </section>:<section className="game-layout">
      <div className="game-topline"><div><span className="eyebrow">ROUND IN PROGRESS</span><h2>{room.status==="finished"?"Game over":isMyTurn?"Your turn":"Waiting for "+(activePlayer?.name||"player")}</h2></div><div className={`color-indicator ${colorLabel}`}>{colorLabel.toUpperCase()}</div></div>
      <div className="table">
        <div className="table-rim">
          <div className="opponents">{room.players.filter(p=>p.id!==myId).map((p,i)=><div className={`opponent ${p.id===room.turnPlayerId?"active":""}`} key={p.id}><div className={`avatar a${i%6}`}>{p.name.slice(0,1).toUpperCase()}</div><b>{p.name}</b><small>{p.cardCount} cards</small><div className="mini-hand">{Array.from({length:Math.min(5,p.cardCount)},(_,j)=><Card key={j} back small/>)}</div>{p.id===room.pendingUno?.playerId&&<button className="catch" onClick={()=>socket.emit("catchUno",{playerId:p.id})}>CATCH UNO!</button>}</div>)}</div>
          <div className="center-piles"><div className="pile-wrap"><small>DRAW PILE</small><button className="draw-stack" disabled={!isMyTurn||room.status!=="playing"||!!room.pendingChallenge} onClick={()=>socket.emit("drawCard")}><Card back/><b>{room.drawCount}</b></button></div><div className="direction"><RotateCcw size={23}/><small>{room.direction===1?"CLOCKWISE":"COUNTER-CLOCKWISE"}</small></div><div className="pile-wrap"><small>DISCARD PILE</small><div className="discard-card">{room.topCard&&<Card card={{...room.topCard,color:room.topCard.color==="wild"?room.activeColor:room.topCard.color}}/>}</div></div></div>
          <div className="table-status">{room.lastAction}</div>
        </div>
      </div>
      {room.pendingChallenge&&pendingChallenge&&<div className="challenge-banner"><ShieldAlert/><div><b>Wild Draw Four played!</b><span>Challenge if you think they held a card matching the previous colour.</span></div><button className="secondary" onClick={()=>socket.emit("challengeWild4")}>Challenge</button><button className="primary" onClick={()=>socket.emit("acceptWild4")}>Accept +4</button></div>}
      {room.pendingDraw&&pendingDraw&&<div className="penalty-banner">Draw {room.pendingDraw.count} cards. Your turn will be skipped. <button className="primary" onClick={()=>socket.emit("drawCard")}>Draw {room.pendingDraw.count}</button></div>}
      {room.pendingUno&&room.pendingUno.playerId===myId&&<button className="uno-alert" onClick={()=>socket.emit("callUno")}>UNO! CALL IT NOW</button>}
      {room.status==="finished"&&<div className="winner-banner"><Crown/><b>{room.players.find(p=>p.id===room.winnerId)?.name} wins!</b>{me?.isHost&&<button className="primary" onClick={()=>{setError("A new round requires creating a fresh room in this first version.");}}>New game</button>}</div>}
      <div className="hand-area"><div className="hand-head"><div><small>YOUR HAND</small><b>{room.myHand.length} cards</b></div><span>{isMyTurn?"CHOOSE A CARD":"WAIT FOR YOUR TURN"}</span></div><div className="hand-cards">{room.myHand.map(c=><Card key={c.id} card={c} disabled={!canPlay(c)||room.status!=="playing"} onClick={()=>play(c)}/>)}</div></div>
      {(chosen || room.pendingOpeningWild?.chooserId===myId)&&<div className="modal-backdrop"><div className="color-modal"><h2>Choose a colour</h2><p>{chosen?"What colour should the next player match?":"Choose the starting colour for this game."}</p><div className="color-options">{COLORS.map(c=><button key={c} className={c} onClick={()=>chooseColor(c)}>{c}</button>)}</div><button className="text-btn" onClick={()=>setChosen(null)}>Cancel</button></div></div>}
      {showChat&&<aside className="chat-panel"><div className="chat-head"><b>Table chat</b><button onClick={()=>setShowChat(false)}>×</button></div><div className="chat-messages">{messages.map((m,i)=><p key={i}><b>{m.name}</b> {m.text}</p>)}</div><form onSubmit={sendChat}><input value={chat} onChange={e=>setChat(e.target.value)} placeholder="Say something…"/><button><Send size={16}/></button></form></aside>}
      {error&&<div className="toast" onClick={()=>setError("")}>{error} <b>×</b></div>}
    </section>}
  </main>;
}
export default App;
