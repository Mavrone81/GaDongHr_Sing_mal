'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Script from 'next/script';
import { useAuth } from '@/context/AuthContext';

// face-api.js is loaded as a UMD script from /js/face-api.min.js
// and exposes itself on window.faceapi — no webpack bundling needed
declare global {
  interface Window {
    faceapi: typeof import('face-api.js');
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ClockState = 'idle' | 'camera' | 'capturing' | 'verifying' | 'success' | 'failed' | 'no_photo' | 'upload_photo';

interface AttendanceRecord {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  duration: string | null;
  status: 'present' | 'half' | 'absent' | 'leave';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apiBase() {
  const h = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  return `http://${h}:4000/api`;
}

function getToken(): string {
  if (typeof document === 'undefined') return '';
  return document.cookie.split('ezyhrm_token=')[1]?.split(';')[0] ?? '';
}

// ─── Clock display ────────────────────────────────────────────────────────────

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const timeStr = now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  const dateStr = now.toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <div className="text-center">
      <p className="text-6xl font-black text-white tracking-tighter tabular-nums">{timeStr}</p>
      <p className="text-sm font-bold text-slate-400 mt-2 uppercase tracking-widest">{dateStr}</p>
    </div>
  );
}

// ─── Mock week data ───────────────────────────────────────────────────────────

const MOCK_WEEK: AttendanceRecord[] = [
  { date: 'Mon 28 Apr', clockIn: '08:58 AM', clockOut: '06:02 PM', duration: '9h 04m', status: 'present' },
  { date: 'Tue 29 Apr', clockIn: null, clockOut: null, duration: null, status: 'absent' },
  { date: 'Wed 30 Apr', clockIn: null, clockOut: null, duration: null, status: 'absent' },
  { date: 'Thu 1 May',  clockIn: null, clockOut: null, duration: null, status: 'absent' },
  { date: 'Fri 2 May',  clockIn: null, clockOut: null, duration: null, status: 'absent' },
];

// ─── Employee self-service view ───────────────────────────────────────────────

function EmployeeAttendanceView() {
  const { user } = useAuth();
  const [clockState, setClockState]   = useState<ClockState>('idle');
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [clockInTime, setClockInTime] = useState<Date | null>(null);
  const [confidence, setConfidence]   = useState(0);
  const [capturedImg, setCapturedImg] = useState<string | null>(null);
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [weekLog, setWeekLog]         = useState<AttendanceRecord[]>(MOCK_WEEK);

  // Upload photo state
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadSaving, setUploadSaving]   = useState(false);
  const [uploadError, setUploadError]     = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const videoRef         = useRef<HTMLVideoElement>(null);
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);

  // ── Load face-api models once the UMD script is ready ────────────────────
  const loadFaceModels = useCallback(async () => {
    if (!window.faceapi) return;
    try {
      const MODEL_URL = '/models';
      await Promise.all([
        window.faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        window.faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        window.faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      setModelsLoaded(true);
    } catch (e) {
      console.error('face-api models failed to load', e);
    }
  }, []);

  // ── Fetch profile photo on mount ──────────────────────────────────────────
  useEffect(() => {
    async function fetchPhoto() {
      try {
        const res = await fetch(`${apiBase()}/employees/me/photo`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (res.ok) {
          const data = await res.json();
          setProfilePhoto(data.profilePhotoUrl ?? null);
        }
      } catch (e) {
        console.error('Failed to fetch profile photo', e);
      } finally {
        setPhotoLoading(false);
      }
    }
    fetchPhoto();
  }, []);

  // ── Attach camera stream after video element is in DOM ────────────────────
  useEffect(() => {
    if (clockState === 'camera' && pendingStreamRef.current && videoRef.current) {
      const video  = videoRef.current;
      const stream = pendingStreamRef.current;
      pendingStreamRef.current = null;
      video.srcObject = stream;
      video.play().catch(() => {
        setCameraError('Could not start video stream. Please try again.');
        setClockState('idle');
      });
    }
  }, [clockState]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = async () => {
    if (!profilePhoto) { setClockState('no_photo'); return; }
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' },
      });
      streamRef.current    = stream;
      pendingStreamRef.current = stream;
      setClockState('camera');
    } catch {
      setCameraError('Camera access denied. Please allow camera permission and try again.');
    }
  };

  // ── Face comparison with face-api.js ──────────────────────────────────────
  const captureAndVerify = async () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setClockState('capturing');
    canvas.width  = video.videoWidth  || 480;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    const imageData = canvas.toDataURL('image/jpeg', 0.92);
    setCapturedImg(imageData);
    stopCamera();
    setClockState('verifying');
    setVerifyError(null);

    try {
      const faceapi = window.faceapi;

      const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });

      // Detect face in captured frame
      const capturedEl = await createImgElement(imageData);
      const capturedResult = await faceapi
        .detectSingleFace(capturedEl, detectorOpts)
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!capturedResult) {
        setVerifyError('No face detected in captured image. Please ensure your face is clearly visible.');
        setClockState('failed');
        return;
      }

      // Detect face in profile photo
      const profileEl = await createImgElement(profilePhoto!);
      const profileResult = await faceapi
        .detectSingleFace(profileEl, detectorOpts)
        .withFaceLandmarks(true)
        .withFaceDescriptor();

      if (!profileResult) {
        setVerifyError('Could not detect a face in your profile photo. Please update your profile photo with a clear face shot.');
        setClockState('failed');
        return;
      }

      // Euclidean distance — < 0.45 = same person (strict), < 0.6 = likely same
      const distance   = faceapi.euclideanDistance(capturedResult.descriptor, profileResult.descriptor);
      const similarity = Math.max(0, Math.round((1 - distance) * 100));
      setConfidence(similarity);

      if (distance < 0.55) {
        setClockState('success');
        setTimeout(() => {
          if (!isClockedIn) {
            setIsClockedIn(true);
            const now = new Date();
            setClockInTime(now);
            setWeekLog(prev => prev.map((r, i) => i === 1
              ? { ...r, clockIn: now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true }), status: 'present' }
              : r
            ));
          } else {
            const now = new Date();
            setIsClockedIn(false);
            const dur = clockInTime ? Math.round((now.getTime() - clockInTime.getTime()) / 60000) : 0;
            const h   = Math.floor(dur / 60), m = dur % 60;
            setWeekLog(prev => prev.map((r, i) => i === 1
              ? { ...r, clockOut: now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true }), duration: `${h}h ${m}m` }
              : r
            ));
          }
          setClockState('idle');
          setCapturedImg(null);
        }, 2500);
      } else {
        setClockState('failed');
      }
    } catch (err) {
      console.error('Face verification error', err);
      setVerifyError('Verification encountered an error. Please try again.');
      setClockState('failed');
    }
  };

  // ── Upload profile photo ──────────────────────────────────────────────────
  const handlePhotoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setUploadError('Please select an image file.'); return; }
    if (file.size > 2_000_000) { setUploadError('Image must be under 2MB.'); return; }
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = ev => setUploadPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const saveProfilePhoto = async () => {
    if (!uploadPreview) return;
    setUploadSaving(true);
    setUploadError(null);
    try {
      const res = await fetch(`${apiBase()}/employees/me/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ profilePhotoUrl: uploadPreview }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to save photo');
      }
      setProfilePhoto(uploadPreview);
      setUploadPreview(null);
      setClockState('idle');
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Failed to save photo');
    } finally {
      setUploadSaving(false);
    }
  };

  const retry = () => {
    setCapturedImg(null);
    setConfidence(0);
    setVerifyError(null);
    setClockState('idle');
  };

  const statusColor = (s: AttendanceRecord['status']) => {
    if (s === 'present') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (s === 'half')    return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    if (s === 'leave')   return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    return 'bg-slate-700/30 text-slate-500 border-slate-700/30';
  };

  return (
    <>
    <Script src="/js/face-api.min.js" strategy="afterInteractive" onLoad={loadFaceModels} />
    <div className="flex flex-col gap-6 max-w-[1100px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* ── Main Clock-in Card ──────────────────────────────────────────────── */}
      <div className="bg-[#0a0f1e] rounded-[2rem] overflow-hidden border border-white/5 shadow-2xl shadow-black/40">

        {/* Top: clock + status */}
        <div className="relative px-10 pt-10 pb-8 text-center border-b border-white/5">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/20 via-transparent to-slate-900/30" />
          <div className="relative z-10">
            <p className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-5">
              {user?.name ? `Welcome, ${user.name.split(' ')[0]}` : 'Employee Self-Service'} · Attendance
            </p>
            <LiveClock />
            <div className="mt-6 flex items-center justify-center">
              {isClockedIn ? (
                <span className="flex items-center gap-2 text-emerald-400 border-emerald-500/30 bg-emerald-500/10 px-4 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  Clocked In · {clockInTime?.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </span>
              ) : (
                <span className="flex items-center gap-2 text-slate-400 border-slate-700/40 bg-slate-800/40 px-4 py-1.5 rounded-full border text-[10px] font-black uppercase tracking-widest">
                  <span className="w-2 h-2 bg-slate-600 rounded-full" />
                  Not clocked in
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Camera / verification panel */}
        <div className="px-10 py-8">

          {/* IDLE state */}
          {clockState === 'idle' && (
            <div className="flex flex-col items-center gap-6">
              {cameraError && (
                <div className="w-full max-w-md px-5 py-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-[11px] font-bold text-red-400 text-center">
                  {cameraError}
                </div>
              )}
              {photoLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-4 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin" />
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Loading profile…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-5">
                  {/* Profile photo preview */}
                  <div className="flex flex-col items-center gap-2">
                    {profilePhoto ? (
                      <div className="relative">
                        <img src={profilePhoto} className="w-20 h-20 rounded-[1.5rem] object-cover border-2 border-indigo-500/30" alt="Profile" />
                        <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30">
                          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        </div>
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-[1.5rem] bg-white/5 border border-white/8 flex items-center justify-center">
                        <svg className="w-9 h-9 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                        </svg>
                      </div>
                    )}
                    <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
                      {profilePhoto ? 'Face ID ready' : 'No profile photo'}
                    </p>
                  </div>

                  {!modelsLoaded && profilePhoto && (
                    <p className="text-[9px] font-black text-indigo-400/70 uppercase tracking-widest animate-pulse">Loading face recognition models…</p>
                  )}

                  <div className="flex flex-col items-center gap-3">
                    <button
                      onClick={startCamera}
                      disabled={!modelsLoaded && !!profilePhoto}
                      className={`flex items-center gap-3 px-10 py-5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-2xl disabled:opacity-40 disabled:cursor-not-allowed ${
                        isClockedIn
                          ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-500/20'
                          : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-500/20'
                      }`}
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0zM18.75 10.5h.008v.008h-.008V10.5z" />
                      </svg>
                      {isClockedIn ? 'Clock Out via Face ID' : 'Clock In via Face ID'}
                    </button>

                    {/* Update photo link */}
                    <button
                      onClick={() => { setUploadPreview(null); setUploadError(null); setClockState('upload_photo'); }}
                      className="text-[9px] font-black text-slate-600 hover:text-indigo-400 uppercase tracking-widest transition-all"
                    >
                      {profilePhoto ? 'Update Profile Photo' : '+ Add Profile Photo'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* NO PHOTO prompt */}
          {clockState === 'no_photo' && (
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="w-20 h-20 bg-amber-500/15 border border-amber-500/25 rounded-[2rem] flex items-center justify-center">
                <svg className="w-10 h-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                </svg>
              </div>
              <div className="text-center max-w-xs">
                <p className="text-lg font-black text-amber-400 uppercase tracking-widest">Profile Photo Required</p>
                <p className="text-[11px] font-bold text-slate-400 mt-2 leading-relaxed">
                  Face ID clock-in requires a profile photo on file. Please upload a clear, front-facing photo of yourself.
                </p>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => { setUploadPreview(null); setUploadError(null); setClockState('upload_photo'); }}
                  className="px-8 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95 shadow-xl shadow-indigo-500/20"
                >
                  Add Profile Photo
                </button>
                <button onClick={() => setClockState('idle')} className="px-8 py-4 bg-white/5 border border-white/10 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/8 transition-all">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* UPLOAD PHOTO state */}
          {clockState === 'upload_photo' && (
            <div className="flex flex-col items-center gap-6 py-4 max-w-sm mx-auto">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                {profilePhoto ? 'Update Profile Photo' : 'Add Profile Photo'}
              </p>

              {/* Preview / drop zone */}
              <div
                className="relative w-52 h-52 rounded-[2rem] border-2 border-dashed border-white/15 bg-white/3 flex items-center justify-center cursor-pointer hover:border-indigo-400/40 hover:bg-indigo-500/5 transition-all overflow-hidden"
                onClick={() => uploadInputRef.current?.click()}
              >
                {uploadPreview ? (
                  <img src={uploadPreview} className="w-full h-full object-cover" alt="Preview" />
                ) : profilePhoto ? (
                  <>
                    <img src={profilePhoto} className="w-full h-full object-cover opacity-40" alt="Current" />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <svg className="w-8 h-8 text-white/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" /></svg>
                      <p className="text-[9px] font-black text-white/60 mt-1 uppercase tracking-wider">Replace</p>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-slate-600">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                    <p className="text-[9px] font-black uppercase tracking-wider text-center px-4">Click to select photo</p>
                  </div>
                )}
              </div>

              <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFileChange} />

              {uploadError && (
                <p className="text-[10px] font-bold text-red-400 text-center">{uploadError}</p>
              )}

              <p className="text-[9px] font-bold text-slate-500 text-center leading-relaxed px-4">
                Use a clear, front-facing photo with good lighting. This will be used for face verification during clock-in.
              </p>

              <div className="flex gap-3 w-full">
                <button
                  onClick={saveProfilePhoto}
                  disabled={!uploadPreview || uploadSaving}
                  className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20"
                >
                  {uploadSaving ? 'Saving…' : 'Save Photo'}
                </button>
                <button
                  onClick={() => setClockState('idle')}
                  className="flex-1 py-4 bg-white/5 border border-white/10 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/8 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* CAMERA state */}
          {clockState === 'camera' && (
            <div className="flex flex-col lg:flex-row gap-6 items-center justify-center">
              {/* Live camera */}
              <div className="flex flex-col items-center gap-3">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Live Camera</p>
                <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black" style={{ width: 280, height: 280 }}>
                  <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-44 h-52 border-2 border-indigo-400/60 rounded-full" style={{ boxShadow: '0 0 0 9999px rgba(10,15,30,0.5)' }} />
                  </div>
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                    <span className="text-[9px] font-black text-indigo-300 uppercase tracking-widest bg-indigo-900/60 px-3 py-1 rounded-full backdrop-blur-sm">
                      Position face in oval
                    </span>
                  </div>
                </div>
                <button
                  onClick={captureAndVerify}
                  className="mt-1 px-10 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95 shadow-xl shadow-indigo-500/20 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 18a8 8 0 110-16 8 8 0 010 16z" /></svg>
                  Capture & Verify
                </button>
              </div>

              {/* VS divider */}
              <div className="flex lg:flex-col items-center gap-2">
                <div className="w-16 h-px lg:w-px lg:h-16 bg-white/10" />
                <span className="text-[9px] font-black text-slate-600 uppercase">vs</span>
                <div className="w-16 h-px lg:w-px lg:h-16 bg-white/10" />
              </div>

              {/* Profile photo */}
              <div className="flex flex-col items-center gap-3">
                <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Profile Photo</p>
                <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-slate-900" style={{ width: 280, height: 280 }}>
                  {profilePhoto ? (
                    <img src={profilePhoto} className="w-full h-full object-cover" alt="Profile" />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-600 gap-3">
                      <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" /></svg>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-center px-4 leading-relaxed">No profile photo</span>
                    </div>
                  )}
                </div>
                <button onClick={() => { stopCamera(); setClockState('idle'); }} className="text-[9px] font-black text-slate-500 hover:text-red-400 uppercase tracking-widest transition-all">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* CAPTURING / VERIFYING state */}
          {(clockState === 'verifying' || clockState === 'capturing') && (
            <div className="flex flex-col items-center gap-8 py-4">
              <div className="flex gap-8 items-center">
                {/* Captured frame */}
                <div className="flex flex-col items-center gap-2">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Captured</p>
                  <div className="rounded-2xl overflow-hidden border border-white/10" style={{ width: 160, height: 160 }}>
                    {capturedImg
                      ? <img src={capturedImg} className="w-full h-full object-cover" alt="Captured" />
                      : <div className="w-full h-full bg-slate-800 animate-pulse" />
                    }
                  </div>
                </div>

                {/* Spinner */}
                <div className="flex flex-col items-center gap-4">
                  <div className="relative w-20 h-20">
                    <div className="absolute inset-0 border-4 border-indigo-600/20 border-t-indigo-500 rounded-full animate-spin" />
                    <div className="absolute inset-3 border-4 border-slate-800 border-t-indigo-400/40 rounded-full animate-spin [animation-direction:reverse] [animation-duration:0.7s]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-7 h-7 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565" /></svg>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-black text-white uppercase tracking-widest">Analysing face…</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Comparing against profile record</p>
                  </div>
                </div>

                {/* Profile photo reference */}
                <div className="flex flex-col items-center gap-2">
                  <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Profile</p>
                  <div className="rounded-2xl overflow-hidden border border-white/10 bg-slate-900" style={{ width: 160, height: 160 }}>
                    {profilePhoto
                      ? <img src={profilePhoto} className="w-full h-full object-cover" alt="Profile reference" />
                      : <div className="w-full h-full bg-slate-800" />
                    }
                  </div>
                </div>
              </div>

              {/* Scanning bars */}
              <div className="flex items-end gap-1 h-8">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="w-1.5 bg-indigo-600 rounded-full animate-pulse" style={{ height: `${20 + Math.sin(i) * 16}px`, animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
            </div>
          )}

          {/* SUCCESS state */}
          {clockState === 'success' && (
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="flex gap-8 items-center">
                {capturedImg && (
                  <div className="relative">
                    <img src={capturedImg} className="w-28 h-28 rounded-2xl object-cover border-2 border-emerald-500/30" alt="Verified" />
                    <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg shadow-emerald-500/30">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    </div>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-2xl font-black text-emerald-400 uppercase tracking-widest">Identity Verified</p>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                    Match score: {confidence}% · {isClockedIn ? 'Clock-out' : 'Clock-in'} recorded
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* FAILED state */}
          {clockState === 'failed' && (
            <div className="flex flex-col items-center gap-6 py-4">
              <div className="flex gap-8 items-center">
                {capturedImg && (
                  <div className="relative">
                    <img src={capturedImg} className="w-28 h-28 rounded-2xl object-cover border-2 border-red-500/30" alt="Unverified" />
                    <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-red-500 rounded-full flex items-center justify-center shadow-lg shadow-red-500/30">
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </div>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-2xl font-black text-red-400 uppercase tracking-widest">Verification Failed</p>
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mt-2">
                    {verifyError ?? `Match score ${confidence}% — face not recognised. Please try again.`}
                  </p>
                </div>
              </div>
              <div className="flex gap-4 mt-2">
                <button onClick={retry} className="px-8 py-4 bg-indigo-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-500/20">
                  Try Again
                </button>
                <button
                  onClick={() => { retry(); setClockState('upload_photo'); setUploadPreview(null); setUploadError(null); }}
                  className="px-8 py-4 bg-white/5 border border-white/10 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-white/8 transition-all"
                >
                  Update Photo
                </button>
              </div>
            </div>
          )}

          {/* Off-screen canvas for capture */}
          <canvas ref={canvasRef} style={{ position: 'absolute', top: '-9999px', left: '-9999px', width: 0, height: 0 }} />
        </div>
      </div>

      {/* ── This Week's Log ──────────────────────────────────────────────────── */}
      <div className="bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-indigo-500/5 overflow-hidden">
        <div className="px-8 py-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">This Week</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">28 Apr – 2 May 2026</p>
          </div>
          <div className="px-4 py-2 bg-emerald-50 border border-emerald-100 rounded-xl">
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">1 / 5 days</p>
          </div>
        </div>
        <div className="divide-y divide-slate-50">
          {weekLog.map((rec, i) => (
            <div key={i} className="flex items-center px-8 py-4 hover:bg-slate-50/50 transition-all">
              <div className="w-28">
                <p className="text-[11px] font-black text-slate-700 uppercase tracking-tight">{rec.date}</p>
              </div>
              <div className="flex-1 flex items-center gap-6">
                <div className="flex flex-col">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Clock In</p>
                  <p className="text-xs font-black text-slate-900 mt-0.5">{rec.clockIn ?? '—'}</p>
                </div>
                <div className="flex flex-col">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Clock Out</p>
                  <p className="text-xs font-black text-slate-900 mt-0.5">{rec.clockOut ?? '—'}</p>
                </div>
                <div className="flex flex-col">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Duration</p>
                  <p className="text-xs font-bold text-indigo-600 mt-0.5">{rec.duration ?? '—'}</p>
                </div>
              </div>
              <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-lg border ${statusColor(rec.status)}`}>
                {rec.status === 'present' ? 'Present' : rec.status === 'half' ? 'Half Day' : rec.status === 'leave' ? 'On Leave' : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
  );
}

// ─── Helper: create an HTMLImageElement from a data URL ──────────────────────

function createImgElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src     = src;
  });
}

// ─── Entry point — always the employee self-service clock-in view ─────────────

export default function AttendancePage() {
  return <EmployeeAttendanceView />;
}
