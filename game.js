(() => {
"use strict";
const $=id=>document.getElementById(id), MAX_PLAYERS=8;
const panels=["homePanel","joinPanel","roomPanel","setupPanel"];
const showPanel=id=>panels.forEach(p=>$(p).classList.toggle("hidden",p!==id));
const alphabet="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode=()=>Array.from({length:6},()=>alphabet[Math.floor(Math.random()*alphabet.length)]).join("");
const VEHICLES={sport:{color:"#ff525d",width:34,height:58},classic:{color:"#f4bd52",width:36,height:60},truck:{color:"#4d9dff",width:42,height:66},taxi:{color:"#f5d84d",width:36,height:60}};
let peer=null,role=null,roomCode="",myId="host",mode="pc",vehicle="sport",localReady=false,gameStarted=false;
let hostConnections=new Map(),players=new Map(),inputs=new Map(),lastInput={steer:0,gas:0,brake:0};
let lastSent=0,lastSnapshot=0,raf=0,roadOffset=0;
const canvas=$("roadCanvas"),ctx=canvas.getContext("2d");
function status(s){$("connectionStatus").textContent=s;}
function clamp(v){return Math.max(-1,Math.min(1,Number(v)||0));}
function peerId(code){return "ymgenv-drive-"+code.toLowerCase();}
function sendTo(c,m){if(c&&c.open)c.send(m);}
function broadcast(m){hostConnections.forEach(c=>sendTo(c,m));}
function closeNetwork(){hostConnections.forEach(c=>{try{c.close();}catch{}});hostConnections.clear();try{peer?.destroy();}catch{}peer=null;}
function initPeer(id){return new Promise((resolve,reject)=>{peer=id?new Peer(id):new Peer();peer.on("open",resolve);peer.on("error",reject);peer.on("disconnected",()=>status("PeerJS connection lost. Refresh to reconnect."));});}
function roster(){return [...players.values()].map(p=>({...p}));}
function drawRoster(){
 const box=$("playerSlots");box.innerHTML="";
 const list=roster().sort((a,b)=>a.id==="host"?-1:b.id==="host"?1:a.id.localeCompare(b.id));
 list.forEach((p,i)=>{const row=document.createElement("div");row.className="slot";const dot=document.createElement("span");dot.className="dot"+(p.connected?"":" waiting");const label=document.createElement("span");label.textContent=(p.id==="host"?"Host":p.id===myId?"You":"Player "+(i+1))+" · "+(p.ready?"Ready":p.connected?"Connected":"Waiting");row.append(dot,label);box.append(row);});
 for(let i=list.length;i<MAX_PLAYERS;i++){const row=document.createElement("div");row.className="slot";const dot=document.createElement("span");dot.className="dot waiting";const label=document.createElement("span");label.textContent="Open driver slot";row.append(dot,label);box.append(row);}
 $("playerCount").textContent=list.length+" / "+MAX_PLAYERS+" players";
 $("playerTagYou").textContent="YOU · "+list.length+" DRIVERS";
}
function roomUpdate(){drawRoster();broadcast({type:"room-update",players:roster()});}
function attachHostConnection(c){
 c.on("open",()=>{
  if(gameStarted||players.size>=MAX_PLAYERS){sendTo(c,{type:"full",limit:MAX_PLAYERS});c.close();return;}
  const id="p"+Math.random().toString(36).slice(2,9);
  c.playerId=id;hostConnections.set(id,c);
  players.set(id,{id,x:.5,speed:0,vehicle:"sport",ready:false,connected:true});
  inputs.set(id,{steer:0,gas:0,brake:0});
  sendTo(c,{type:"welcome",code:roomCode,playerId:id,players:roster()});
  roomUpdate();status("Room open · "+players.size+" of "+MAX_PLAYERS+" drivers connected.");
 });
 c.on("data",m=>{
  if(!m||typeof m!=="object")return;
  const id=c.playerId,p=players.get(id);if(!p)return;
  if(m.type==="ready"){p.ready=!!m.ready;if(VEHICLES[m.vehicle])p.vehicle=m.vehicle;roomUpdate();maybeStart();}
  if(m.type==="input")inputs.set(id,{steer:clamp(m.steer),gas:clamp(m.gas),brake:clamp(m.brake)});
  if(m.type==="leave")c.close();
 });
 c.on("close",()=>{
  const id=c.playerId;if(!id)return;
  hostConnections.delete(id);players.delete(id);inputs.delete(id);roomUpdate();
  status("A player left · "+players.size+" of "+MAX_PLAYERS+" drivers remain.");
 });
}
async function createRoom(){
 closeNetwork();role="host";myId="host";roomCode=makeCode();localReady=false;gameStarted=false;players.clear();inputs.clear();
 players.set("host",{id:"host",x:.5,speed:0,vehicle:"sport",ready:false,connected:true});
 showPanel("roomPanel");$("roomHeading").textContent="Your room";$("roomCode").textContent=roomCode;$("continueBtn").disabled=false;
 drawRoster();status("Creating room…");
 try{await initPeer(peerId(roomCode));peer.on("connection",attachHostConnection);status("Room created. Share the code with up to 7 friends.");}
 catch(e){status(e.type==="unavailable-id"?"Room code already in use. Create another room.":"Could not create room. Check your internet connection.");$("roomCode").textContent="ERROR";}
}
async function joinRoom(code){
 closeNetwork();role="guest";roomCode=code;localReady=false;gameStarted=false;
 showPanel("roomPanel");$("roomHeading").textContent="Joined room";$("roomCode").textContent=roomCode;$("continueBtn").disabled=true;status("Connecting to host…");
 try{await initPeer();const c=peer.connect(peerId(roomCode),{reliable:true});c.on("open",()=>status("Connected. Loading room…"));c.on("data",onGuestData);c.on("close",()=>status("Disconnected from host."));c.on("error",e=>status("Connection error: "+e.message));setTimeout(()=>{if(!myId||myId==="host")status("No host found or room is full. Check the code.");},10000);window.guestConnection=c;}
 catch(e){status("Could not join. Check the room code and connection.");}
}
function onGuestData(m){
 if(!m||typeof m!=="object")return;
 if(m.type==="full"){status("This room is full. Maximum is 8 players.");return;}
 if(m.type==="welcome"){myId=m.playerId;players.clear();(m.players||[]).forEach(p=>players.set(p.id,p));$("continueBtn").disabled=false;drawRoster();status("You're in! Choose your driving mode and vehicle.");}
 if(m.type==="room-update"){players.clear();(m.players||[]).forEach(p=>players.set(p.id,p));drawRoster();}
 if(m.type==="start"){gameStarted=true;showGame();}
 if(m.type==="snapshot"){players.clear();(m.players||[]).forEach(p=>players.set(p.id,p));roadOffset=m.road||0;drawRoster();if(!gameStarted&&m.started){gameStarted=true;showGame();}}
 if(m.type==="leave")status("The host ended the room.");
}
function maybeStart(){
 if(role!=="host"||gameStarted||!localReady)return;
 const all=[...players.values()];
 if(all.length>=2&&all.every(p=>p.ready)){gameStarted=true;broadcast({type:"start"});showGame();}
 else $("readyStatus").textContent=all.filter(p=>p.ready).length+" of "+all.length+" players ready. Host starts when everyone is ready.";
}
function enterReady(){
 mode=document.querySelector(".modeBtn.active").dataset.mode;vehicle=$("vehicleSelect").value;localReady=true;
 if(role==="host"){const p=players.get("host");p.ready=true;p.vehicle=vehicle;roomUpdate();maybeStart();}
 else{const c=window.guestConnection;if(c&&c.open)c.send({type:"ready",ready:true,vehicle,mode});$("readyStatus").textContent="Ready. Waiting for all players and the host…";}
}
function showGame(){
 $("lobby").classList.add("hidden");$("game").classList.remove("hidden");$("gameRoom").textContent="ROOM "+roomCode;
 $("mobileControls").classList.toggle("hidden",mode!=="mobile");if(!raf)raf=requestAnimationFrame(loop);
}
function resize(){const d=Math.min(devicePixelRatio||1,2),w=innerWidth,h=innerHeight;canvas.width=Math.round(w*d);canvas.height=Math.round(h*d);canvas.style.width=w+"px";canvas.style.height=h+"px";ctx.setTransform(d,0,0,d,0,0);}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function drawCar(x,y,v,me){const s=VEHICLES[v]||VEHICLES.sport,w=s.width,h=s.height;ctx.save();ctx.translate(x,y);ctx.fillStyle="#0008";ctx.beginPath();ctx.ellipse(2,8,w*.62,h*.53,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=s.color;roundRect(-w/2,-h/2,w,h,8);ctx.fill();ctx.fillStyle="#172536";roundRect(-w*.34,-h*.29,w*.68,h*.28,5);ctx.fill();ctx.fillStyle="#9dd9ed";roundRect(-w*.34,h*.08,w*.68,h*.19,4);ctx.fill();if(me){ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.strokeRect(-w/2-2,-h/2-2,w+4,h+4);}ctx.restore();}
function render(){
 const w=innerWidth,h=innerHeight,rw=Math.min(w*.72,620),cx=w/2;ctx.clearRect(0,0,w,h);ctx.fillStyle="#254b31";ctx.fillRect(0,0,w,h);
 for(let i=0;i<18;i++){const y=((i*100+roadOffset*1.7)%(h+100))-50;ctx.fillStyle=i%2?"#2d5938":"#315f3d";ctx.fillRect(0,y,w,48);}
 ctx.fillStyle="#242832";ctx.fillRect(cx-rw/2,0,rw,h);ctx.fillStyle="#e9e2c7";ctx.fillRect(cx-rw/2+8,0,5,h);ctx.fillRect(cx+rw/2-13,0,5,h);
 ctx.fillStyle="#f8f0c9";for(let y=-60;y<h+60;y+=90)ctx.fillRect(cx-3,((y+roadOffset*1.4)%(h+90))-30,6,44);
 const list=roster();const n=list.length;
 list.forEach((p,i)=>{const lane=(i-(n-1)/2)*Math.min(48,rw/Math.max(3,n+1));const x=cx+(p.x-.5)*rw*.55+lane*.45;const y=h*.25+(i%4)*Math.min(64,h*.09);drawCar(x,y,p.vehicle,p.id===myId);});
 const me=players.get(myId);$("speedReadout").textContent=Math.round((me?.speed||0)*180)+" KM/H";
}
function physics(dt){
 if(role==="host"){
  for(const [id,p] of players){const a=id==="host"?lastInput:(inputs.get(id)||{steer:0,gas:0,brake:0});p.speed=Math.max(0,Math.min(1,p.speed+(a.gas*.65-a.brake*.95-.13)*dt));p.x=Math.max(.08,Math.min(.92,p.x+a.steer*p.speed*.58*dt));}
  roadOffset+=(players.get("host")?.speed||0)*dt*1.6;
  if(performance.now()-lastSnapshot>50){broadcast({type:"snapshot",players:roster(),road:roadOffset,started:true});lastSnapshot=performance.now();}
 }else{
  const c=window.guestConnection,now=performance.now();if(c&&c.open&&now-lastSent>45){c.send({type:"input",steer:lastInput.steer,gas:lastInput.gas,brake:lastInput.brake});lastSent=now;}
 }
}
function loop(now){const dt=Math.min(.05,(now-(loop.last||now))/1000);loop.last=now;if(gameStarted){physics(dt);render();}raf=requestAnimationFrame(loop);}
function control(n,on){if(n==="left")lastInput.steer=on?-1:(lastInput.steer===-1?0:lastInput.steer);if(n==="right")lastInput.steer=on?1:(lastInput.steer===1?0:lastInput.steer);if(n==="gas")lastInput.gas=on?1:0;if(n==="brake")lastInput.brake=on?1:0;}
document.querySelectorAll("[data-control]").forEach(b=>{const n=b.dataset.control;b.addEventListener("pointerdown",e=>{e.preventDefault();b.setPointerCapture(e.pointerId);control(n,true);});["pointerup","pointercancel","lostpointercapture"].forEach(ev=>b.addEventListener(ev,e=>{e.preventDefault();control(n,false);}));});
window.addEventListener("keydown",e=>{const k=e.key.toLowerCase();if(["arrowleft","arrowright","arrowup","arrowdown"," "].includes(k))e.preventDefault();if(k==="a"||k==="arrowleft")control("left",true);if(k==="d"||k==="arrowright")control("right",true);if(k==="w"||k==="arrowup")control("gas",true);if(k==="s"||k==="arrowdown"||k===" ")control("brake",true);});
window.addEventListener("keyup",e=>{const k=e.key.toLowerCase();if(k==="a"||k==="arrowleft")control("left",false);if(k==="d"||k==="arrowright")control("right",false);if(k==="w"||k==="arrowup")control("gas",false);if(k==="s"||k==="arrowdown"||k===" ")control("brake",false);});
document.querySelectorAll(".modeBtn").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".modeBtn").forEach(x=>x.classList.toggle("active",x===b));mode=b.dataset.mode;}));
$("createBtn").onclick=createRoom;$("showJoinBtn").onclick=()=>showPanel("joinPanel");
$("joinBtn").onclick=()=>{const c=$("roomInput").value.trim().toUpperCase();if(!/^[A-HJ-NP-Z2-9]{6}$/.test(c)){alert("Enter the 6-character room code.");return;}joinRoom(c);};
$("roomInput").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g,"").slice(0,6));
document.querySelectorAll(".backBtn").forEach(b=>b.addEventListener("click",()=>showPanel("homePanel")));
$("continueBtn").onclick=()=>{if(role==="host"||window.guestConnection?.open)showPanel("setupPanel");};
$("readyBtn").onclick=enterReady;$("backToRoomBtn").onclick=()=>showPanel("roomPanel");
$("copyCodeBtn").onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);status("Room code copied!");}catch{status("Room code: "+roomCode);}};
$("settingsBtn").onclick=()=>{$("settingsRoomLabel").textContent="Room code: "+roomCode;$("settingsOverlay").classList.remove("hidden");};
$("resumeBtn").onclick=()=>$("settingsOverlay").classList.add("hidden");
$("copySettingsCode").onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);$("settingsRoomLabel").textContent="Room code copied: "+roomCode;}catch{$("settingsRoomLabel").textContent="Room code: "+roomCode;}};
$("leaveGameBtn").onclick=()=>{if(role==="host")broadcast({type:"leave"});else if(window.guestConnection)window.guestConnection.send({type:"leave"});closeNetwork();location.reload();};
$("cancelRoomBtn").onclick=()=>{closeNetwork();showPanel("homePanel");};
window.addEventListener("resize",resize);resize();drawRoster();
})();