(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const panels = ["homePanel","joinPanel","roomPanel","setupPanel"];
  const showPanel = id => panels.forEach(p => $(p).classList.toggle("hidden",p!==id));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const makeCode = () => Array.from({length:6},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join("");
  const VEHICLES = {
    sport:{color:"#ff525d",width:34,height:58},
    classic:{color:"#f4bd52",width:36,height:60},
    truck:{color:"#4d9dff",width:42,height:66},
    taxi:{color:"#f5d84d",width:36,height:60}
  };
  let peer=null, conn=null, role=null, roomCode="", mode="pc", vehicle="sport";
  let connected=false, peerReady=false, localReady=false, remoteReady=false, gameStarted=false;
  let lastInput={steer:0,gas:0,brake:0}, localCar={x:0.32,speed:0,vehicle}, remoteCar={x:0.68,speed:0,vehicle:"classic"};
  let lastSent=0,lastSnapshot=0,raf=0,roadOffset=0,remoteTimestamp=0;
  const canvas=$("roadCanvas"),ctx=canvas.getContext("2d");
  const state={host:{x:.32,speed:0,vehicle:"sport"},guest:{x:.68,speed:0,vehicle:"classic"},road:0,started:false};

  function setStatus(msg){$("connectionStatus").textContent=msg;}
  function send(msg){if(conn&&conn.open)conn.send(msg);}
  function closeNetwork(){try{conn?.close();}catch{}try{peer?.destroy();}catch{}conn=null;peer=null;connected=false;peerReady=false;}
  function peerId(code){return "ymgenv-drive-"+code.toLowerCase();}
  function initPeer(id){
    return new Promise((resolve,reject)=>{
      peer=new Peer(id);
      peer.on("open",()=>resolve());
      peer.on("error",err=>reject(err));
      peer.on("disconnected",()=>{setStatus("Connection to PeerJS server lost. Refresh to reconnect.");});
    });
  }
  function attachConnection(c){
    conn=c;
    c.on("open",()=>{
      connected=true; $("guestDot").classList.remove("waiting"); $("guestSlot").textContent="Player 2 · Connected";
      setStatus("Friend connected! Both players can choose their setup.");
      $("continueBtn").disabled=false;
      c.send({type:"welcome",code:roomCode});
    });
    c.on("data",onData);
    c.on("close",()=>{
      connected=false;remoteReady=false;$("guestDot").classList.add("waiting");
      $("guestSlot").textContent="Player 2 · Disconnected";
      setStatus("Your friend disconnected. Waiting for them to rejoin…");
      $("continueBtn").disabled=true;
    });
    c.on("error",e=>setStatus("Connection error: "+e.message));
  }
  async function createRoom(){
    closeNetwork();role="host";roomCode=makeCode();
    showPanel("roomPanel");$("roomHeading").textContent="Your room";$("roomCode").textContent=roomCode;
    $("hostSlot").textContent="Host · You";$("guestSlot").textContent="Player 2 · Waiting";$("guestDot").classList.add("waiting");
    $("continueBtn").disabled=true;setStatus("Creating your room…");
    try{
      await initPeer(peerId(roomCode));
      peer.on("connection",c=>{
        if(conn&&conn.open){c.close();return;}
        attachConnection(c);
      });
      setStatus("Room created. Share the code with one friend.");
    }catch(e){
      setStatus(e.type==="unavailable-id"?"That room code is already in use. Please create another room.":"Could not create room. Check your internet connection and try again.");
      $("roomCode").textContent="ERROR";
    }
  }
  async function joinRoom(code){
    closeNetwork();role="guest";roomCode=code.toUpperCase();
    showPanel("roomPanel");$("roomHeading").textContent="Joined room";$("roomCode").textContent=roomCode;
    $("hostSlot").textContent="Host · Connected";$("guestSlot").textContent="You · Connecting…";
    $("continueBtn").disabled=true;setStatus("Connecting to host…");
    try{
      await initPeer();
      const c=peer.connect(peerId(roomCode),{reliable:true});
      attachConnection(c);
      const timeout=setTimeout(()=>{if(!connected)setStatus("No host found for that code. Check the code and try again.");},9000);
      c.on("open",()=>clearTimeout(timeout));
    }catch(e){setStatus("Could not join this room. Check the code and try again.");}
  }
  function onData(m){
    if(!m||typeof m!=="object")return;
    if(m.type==="welcome"){roomCode=m.code||roomCode;return;}
    if(m.type==="ready"){
      remoteReady=!!m.ready;
      if(role==="host" && m.vehicle && VEHICLES[m.vehicle]) state.guest.vehicle=m.vehicle;
      if(role==="host")$("readyStatus").textContent=remoteReady?"Your friend is ready. You can start when you are ready.":"Waiting for your friend to be ready.";
      maybeStart();
    }
    if(m.type==="input"&&role==="host"){
      state.guestInput={steer:clamp(m.steer),gas:clamp(m.gas),brake:clamp(m.brake)};
    }
    if(m.type==="snapshot"&&role==="guest"){
      state.host=m.host;state.guest=m.guest;state.road=m.road;state.started=m.started;
      gameStarted=!!m.started;remoteTimestamp=performance.now();
      if(gameStarted)showGame();
    }
    if(m.type==="start"&&role==="guest"){gameStarted=true;showGame();}
    if(m.type==="leave"){setStatus("The host ended the room.");}
  }
  function clamp(v){return Math.max(-1,Math.min(1,Number(v)||0));}
  function showGame(){
    $("lobby").classList.add("hidden");$("game").classList.remove("hidden");
    $("gameRoom").textContent="ROOM "+roomCode;
    $("mobileControls").classList.toggle("hidden",mode!=="mobile");
    if(!raf)raf=requestAnimationFrame(loop);
  }
  function maybeStart(){
    if(role==="host"&&localReady&&remoteReady&&!gameStarted){
      gameStarted=true;state.started=true;send({type:"start"});showGame();
    }
  }
  function enterReady(){
    mode=document.querySelector(".modeBtn.active").dataset.mode;
    vehicle=$("vehicleSelect").value;localReady=true;
    if(role==="host"){state.host.vehicle=vehicle;state.host.x=.32;}
    else{state.guest.vehicle=vehicle;state.guest.x=.68;}
    $("readyStatus").textContent=role==="host"?(remoteReady?"Both players ready. Starting…":"You are ready. Waiting for your friend…"):"You are ready. Waiting for the host to start…";
    send({type:"ready",ready:true,vehicle,mode});
    if(role==="guest")showPanel("setupPanel");
    maybeStart();
  }
  function resize(){
    const dpr=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight;
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    canvas.style.width=w+"px";canvas.style.height=h+"px";ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function drawCar(x,y,v,isYou){
    const spec=VEHICLES[v]||VEHICLES.sport,w=spec.width,h=spec.height;
    ctx.save();ctx.translate(x,y);
    ctx.fillStyle="#0008";ctx.beginPath();ctx.ellipse(2,8,w*.62,h*.53,0,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=spec.color;roundRect(-w/2,-h/2,w,h,8);ctx.fill();
    ctx.fillStyle="#172536";roundRect(-w*.34,-h*.29,w*.68,h*.28,5);ctx.fill();
    ctx.fillStyle="#9dd9ed";roundRect(-w*.34,h*.08,w*.68,h*.19,4);ctx.fill();
    ctx.fillStyle="#fff4c7";ctx.fillRect(-w*.39,-h*.48,7,4);ctx.fillRect(w*.18,-h*.48,7,4);
    ctx.fillStyle="#ff514e";ctx.fillRect(-w*.39,h*.42,7,4);ctx.fillRect(w*.18,h*.42,7,4);
    if(isYou){ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.strokeRect(-w/2-2,-h/2-2,w+4,h+4);}
    ctx.restore();
  }
  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
  function render(){
    const w=innerWidth,h=innerHeight,roadW=Math.min(w*.72,520),cx=w/2;
    ctx.clearRect(0,0,w,h);ctx.fillStyle="#254b31";ctx.fillRect(0,0,w,h);
    for(let i=0;i<18;i++){
      const yy=((i*100+roadOffset*1.7)%(h+100))-50;
      ctx.fillStyle=i%2?"#2d5938":"#315f3d";ctx.fillRect(0,yy,w,48);
    }
    ctx.fillStyle="#242832";ctx.fillRect(cx-roadW/2,0,roadW,h);
    ctx.fillStyle="#e9e2c7";ctx.fillRect(cx-roadW/2+8,0,5,h);ctx.fillRect(cx+roadW/2-13,0,5,h);
    ctx.fillStyle="#f8f0c9";
    for(let y=-60;y<h+60;y+=90){let yy=(y+roadOffset*1.4)%(h+90)-30;ctx.fillRect(cx-3,yy,6,44);}
    // distant lane markers
    const hostX=cx+(state.host.x-.5)*roadW*.78;
    const guestX=cx+(state.guest.x-.5)*roadW*.78;
    const myX=role==="host"?hostX:guestX,otherX=role==="host"?guestX:hostX;
    drawCar(myX,h*.72,role==="host"?state.host.vehicle:state.guest.vehicle,true);
    drawCar(otherX,h*.43,role==="host"?state.guest.vehicle:state.host.vehicle,false);
    $("speedReadout").textContent=Math.round((role==="host"?state.host.speed:state.guest.speed)*180)+" KM/H";
  }
  function updatePhysics(dt){
    if(role==="host"){
      const guestIn=state.guestInput||{steer:0,gas:0,brake:0};
      [["host",lastInput],["guest",guestIn]].forEach(([key,input])=>{
        const car=state[key];
        car.speed=Math.max(0,Math.min(1,car.speed+(input.gas*.65-input.brake*.95-.13)*dt));
        car.x=Math.max(.08,Math.min(.92,car.x+input.steer*car.speed*.58*dt));
      });
      state.road+=state.host.speed*dt*1.6;
      if(performance.now()-lastSnapshot>45){
        send({type:"snapshot",host:state.host,guest:state.guest,road:state.road,started:true});
        lastSnapshot=performance.now();
      }
    }else{
      sendInput();
      if(performance.now()-remoteTimestamp>1800&&remoteTimestamp) setStatus("Connection is slow. Reconnecting…");
    }
  }
  function sendInput(){
    const now=performance.now();if(now-lastSent<45)return;lastSent=now;
    send({type:"input",steer:lastInput.steer,gas:lastInput.gas,brake:lastInput.brake});
  }
  function loop(now){
    const dt=Math.min(.05,(now-(loop.last||now))/1000);loop.last=now;
    if(gameStarted){updatePhysics(dt);roadOffset=role==="host"?state.road:(state.road||0);render();}
    raf=requestAnimationFrame(loop);
  }
  function setControl(name,on){
    if(name==="left")lastInput.steer=on?-1:(lastInput.steer===-1?0:lastInput.steer);
    if(name==="right")lastInput.steer=on?1:(lastInput.steer===1?0:lastInput.steer);
    if(name==="gas")lastInput.gas=on?1:0;
    if(name==="brake")lastInput.brake=on?1:0;
  }
  document.querySelectorAll("[data-control]").forEach(b=>{
    const name=b.dataset.control;
    b.addEventListener("pointerdown",e=>{e.preventDefault();b.setPointerCapture(e.pointerId);setControl(name,true);});
    ["pointerup","pointercancel","lostpointercapture"].forEach(ev=>b.addEventListener(ev,e=>{e.preventDefault();setControl(name,false);}));
  });
  window.addEventListener("keydown",e=>{
    const k=e.key.toLowerCase();
    if(["arrowleft","arrowright","arrowup","arrowdown"," "].includes(k))e.preventDefault();
    if(k==="a"||k==="arrowleft")setControl("left",true);
    if(k==="d"||k==="arrowright")setControl("right",true);
    if(k==="w"||k==="arrowup")setControl("gas",true);
    if(k==="s"||k==="arrowdown"||k===" ")setControl("brake",true);
  });
  window.addEventListener("keyup",e=>{
    const k=e.key.toLowerCase();
    if(k==="a"||k==="arrowleft")setControl("left",false);
    if(k==="d"||k==="arrowright")setControl("right",false);
    if(k==="w"||k==="arrowup")setControl("gas",false);
    if(k==="s"||k==="arrowdown"||k===" ")setControl("brake",false);
  });
  document.querySelectorAll(".modeBtn").forEach(b=>b.addEventListener("click",()=>{
    document.querySelectorAll(".modeBtn").forEach(x=>x.classList.toggle("active",x===b));mode=b.dataset.mode;
  }));
  $("createBtn").onclick=createRoom;
  $("showJoinBtn").onclick=()=>showPanel("joinPanel");
  $("joinBtn").onclick=()=>{const c=$("roomInput").value.trim().toUpperCase();if(!/^[A-HJ-NP-Z2-9]{6}$/.test(c)){alert("Enter the 6-character room code.");return;}joinRoom(c);};
  $("roomInput").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g,"").slice(0,6));
  document.querySelectorAll(".backBtn").forEach(b=>b.addEventListener("click",()=>showPanel("homePanel")));
  $("continueBtn").onclick=()=>{if(!connected)return;showPanel("setupPanel");};
  $("readyBtn").onclick=enterReady;
  $("backToRoomBtn").onclick=()=>showPanel("roomPanel");
  $("copyCodeBtn").onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);setStatus("Room code copied!");}catch{setStatus("Room code: "+roomCode);}};
  $("settingsBtn").onclick=()=>{$("settingsRoomLabel").textContent="Room code: "+roomCode;$("settingsOverlay").classList.remove("hidden");};
  $("resumeBtn").onclick=()=>$("settingsOverlay").classList.add("hidden");
  $("copySettingsCode").onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);$("settingsRoomLabel").textContent="Room code copied: "+roomCode;}catch{$("settingsRoomLabel").textContent="Room code: "+roomCode;}};
  $("leaveGameBtn").onclick=()=>{send({type:"leave"});closeNetwork();location.reload();};
  $("cancelRoomBtn").onclick=()=>{closeNetwork();showPanel("homePanel");};
  window.addEventListener("resize",resize);resize();
})();