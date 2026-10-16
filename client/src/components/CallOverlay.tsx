// Voice + video calls (WebRTC). Signalling goes through the existing Socket.IO connection.
import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import type { User } from '../types';

type Peer = { id: string; name: string };
export type CallState = { conversationId: string; peer: Peer; video: boolean; status: 'calling' | 'incoming' | 'connecting' | 'connected' } | null;

// STUN finds your public address. Phones on mobile data often ALSO need a TURN relay:
// set VITE_TURN_URL / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL in client/.env to enable one.
const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
if (turnUrl) ICE.push({ urls: turnUrl.split(',').map(s => s.trim()), username: import.meta.env.VITE_TURN_USERNAME as string, credential: import.meta.env.VITE_TURN_CREDENTIAL as string });

export function useCalls(socket: Socket, user: User) {
  const [call, setCall] = useState<CallState>(null);
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [remote, setRemote] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [endedCount, setEndedCount] = useState(0);
  const callRef = useRef<CallState>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const pending = useRef<RTCIceCandidateInit[]>([]);
  const fn = useRef<any>({});

  const setCallState = (c: CallState) => { callRef.current = c; setCall(c); };

  function cleanup() {
    pcRef.current?.close(); pcRef.current = null;
    localRef.current?.getTracks().forEach(t => t.stop()); localRef.current = null;
    pending.current = [];
    setLocal(null); setRemote(null); setMuted(false); setCamOff(false); setCallState(null); setEndedCount(n => n + 1);
  }

  async function getMedia(video: boolean) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Calls need HTTPS or localhost: browsers block the camera/microphone on plain http addresses.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: video ? { facingMode: 'user' } : false });
    localRef.current = stream; setLocal(stream); return stream;
  }

  function makePc(peerId: string, conversationId: string, stream: MediaStream) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.onicecandidate = e => { if (e.candidate) socket.emit('call:signal', { to: peerId, conversationId, data: { candidate: e.candidate.toJSON() } }); };
    pc.ontrack = e => setRemote(e.streams[0]);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && callRef.current) { setCallState({ ...callRef.current, status: 'connected' }); socket.emit('call:connected', { conversationId: callRef.current.conversationId }); }
      if (pc.connectionState === 'failed') { alert('The call could not connect (network blocked it). A TURN server is needed for this network.'); end(true); }
    };
    pcRef.current = pc; return pc;
  }

  async function start(peer: Peer, conversationId: string, video: boolean) {
    if (callRef.current) return;
    try {
      await getMedia(video);
      setCallState({ conversationId, peer, video, status: 'calling' });
      socket.emit('call:invite', { conversationId, video }, (r: any) => { if (!r?.ok) { alert(r?.error || 'Could not start the call'); cleanup(); } });
    } catch (e: any) { alert(e?.message || 'Could not access camera/microphone'); cleanup(); }
  }

  async function accept() {
    const c = callRef.current; if (!c) return;
    try {
      const stream = await getMedia(c.video);
      makePc(c.peer.id, c.conversationId, stream);
      setCallState({ ...c, status: 'connecting' });
      socket.emit('call:signal', { to: c.peer.id, conversationId: c.conversationId, data: { accepted: true } });
    } catch (e: any) { alert(e?.message || 'Could not access camera/microphone'); end(true); }
  }

  function end(notify: boolean) {
    const c = callRef.current;
    if (c && notify) socket.emit('call:end', { to: c.peer.id, conversationId: c.conversationId });
    cleanup();
  }

  async function flush(pc: RTCPeerConnection) {
    for (const c of pending.current.splice(0)) await pc.addIceCandidate(c).catch(() => {});
  }

  fn.current.onIncoming = (p: { conversationId: string; video: boolean; from: Peer }) => {
    if (callRef.current) { socket.emit('call:end', { to: p.from.id, conversationId: p.conversationId, reason: 'busy' }); return; }
    setCallState({ conversationId: p.conversationId, peer: p.from, video: p.video, status: 'incoming' });
  };
  fn.current.onSignal = async (p: { from: string; conversationId: string; data: any }) => {
    const c = callRef.current; if (!c || c.peer.id !== p.from) return;
    try {
      const d = p.data || {};
      if (d.accepted && localRef.current) {            // caller: callee said yes -> send the offer
        const pc = makePc(c.peer.id, c.conversationId, localRef.current);
        setCallState({ ...c, status: 'connecting' });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call:signal', { to: c.peer.id, conversationId: c.conversationId, data: { description: pc.localDescription } });
      } else if (d.description && pcRef.current) {
        const pc = pcRef.current;
        await pc.setRemoteDescription(d.description);
        await flush(pc);
        if (d.description.type === 'offer') {          // callee: answer the offer
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit('call:signal', { to: c.peer.id, conversationId: c.conversationId, data: { description: pc.localDescription } });
        }
      } else if (d.candidate) {
        const pc = pcRef.current;
        if (pc && pc.remoteDescription) await pc.addIceCandidate(d.candidate).catch(() => {});
        else pending.current.push(d.candidate);
      }
    } catch (e) { console.error('call signalling error', e); }
  };
  fn.current.onEnded = (p: { from: string; reason?: string }) => {
    if (callRef.current?.peer.id !== p.from) return;
    if (p.reason === 'busy') alert('The user is busy on another call.');
    cleanup();
  };

  useEffect(() => {
    const a = (p: any) => fn.current.onIncoming(p), b = (p: any) => fn.current.onSignal(p), c = (p: any) => fn.current.onEnded(p);
    socket.on('call:incoming', a); socket.on('call:signal', b); socket.on('call:ended', c);
    return () => { socket.off('call:incoming', a); socket.off('call:signal', b); socket.off('call:ended', c); cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, user.id]);

  function toggleMute() { localRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; setMuted(!t.enabled); }); }
  function toggleCam() { localRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; setCamOff(!t.enabled); }); }

  return { call, local, remote, muted, camOff, endedCount, start, accept, end, toggleMute, toggleCam };
}

function StreamVideo({ stream, muted = false, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} className={className} autoPlay playsInline muted={muted} />;
}

export function CallOverlay({ calls }: { calls: ReturnType<typeof useCalls> }) {
  const { call, local, remote, muted, camOff } = calls;
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (call?.status !== 'connected') { setSecs(0); return; }
    const t = setInterval(() => setSecs(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [call?.status]);
  if (!call) return null;
  const label = call.status === 'incoming' ? `Incoming ${call.video ? 'video' : 'voice'} call…`
    : call.status === 'calling' ? 'Calling…' : call.status === 'connecting' ? 'Connecting…'
    : `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
  return <div className="call-overlay">
    {/* remote stream always rendered: it carries the audio even in voice calls */}
    <StreamVideo stream={remote} className={`call-remote ${call.video && remote ? '' : 'audio-only'}`} />
    <div className="call-center">
      {!(call.video && remote) && <div className="call-avatar">{call.peer.name.slice(0, 1).toUpperCase()}</div>}
      <h2>{call.peer.name}</h2><p>{label}</p>
    </div>
    {call.video && local && <StreamVideo stream={local} muted className="call-local" />}
    <div className="call-controls">
      {call.status === 'incoming' ? <>
        <button className="call-btn accept" onClick={calls.accept} title="Accept"><Phone /></button>
        <button className="call-btn hang" onClick={() => calls.end(true)} title="Decline"><PhoneOff /></button>
      </> : <>
        <button className={`call-btn ${muted ? 'off' : ''}`} onClick={calls.toggleMute} title="Mute">{muted ? <MicOff /> : <Mic />}</button>
        {call.video && <button className={`call-btn ${camOff ? 'off' : ''}`} onClick={calls.toggleCam} title="Camera">{camOff ? <VideoOff /> : <Video />}</button>}
        <button className="call-btn hang" onClick={() => calls.end(true)} title="Hang up"><PhoneOff /></button>
      </>}
    </div>
  </div>;
}
