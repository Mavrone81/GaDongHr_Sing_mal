'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { getMondayOf, getPeriodBounds, buildPeriodLog } from '@/lib/attendanceUtils';
import type { ViewMode, AttendanceRecord, ApiRecord } from '@/lib/attendanceUtils';
import { todayISO, toISODate } from '@/lib/timezone';

// ─── Types ────────────────────────────────────────────────────────────────────

type ClockState = 'idle' | 'camera' | 'capturing' | 'verifying' | 'success' | 'failed' | 'no_photo' | 'upload_photo';

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
      <p className="text-6xl font-black text-paper tracking-tighter tabular-nums">{timeStr}</p>
      <p className="text-sm font-bold text-muted mt-2 uppercase tracking-widest">{dateStr}</p>
    </div>
  );
}

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
  const [weekLog, setWeekLog]         = useState<AttendanceRecord[]>([]);
  const [weekLoading, setWeekLoading] = useState(true);
  const [viewMode, setViewMode]       = useState<ViewMode>('work-week');
  const [periodOffset, setPeriodOffset] = useState(0);

  // Upload photo state
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploadSaving, setUploadSaving]   = useState(false);
  const [uploadError, setUploadError]     = useState<string | null>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [photoSource, setPhotoSource] = useState<'file' | 'camera'>('file');
  const [retakeKey, setRetakeKey] = useState(0);
  const uploadVideoRef   = useRef<HTMLVideoElement>(null);
  const uploadStreamRef  = useRef<MediaStream | null>(null);
  const uploadCanvasRef  = useRef<HTMLCanvasElement>(null);

  const videoRef         = useRef<HTMLVideoElement>(null);
  const canvasRef        = useRef<HTMLCanvasElement>(null);
  const streamRef        = useRef<MediaStream | null>(null);
  const pendingStreamRef = useRef<MediaStream | null>(null);

  // ── Sync isClockedIn from loaded log so button label is correct on load ────
  useEffect(() => {
    const todayIso = todayISO();
    const todayRec = weekLog.find(r => r.isoDate === todayIso);
    if (todayRec) {
      const clockedIn = !!todayRec.clockIn && !todayRec.clockOut;
      setIsClockedIn(clockedIn);
      if (todayRec.clockIn && clockedIn) {
        // Store today's clock-in time for display
        const todayDate = new Date();
        const [h, m] = todayRec.clockIn.replace(/\s?(AM|PM)/, '').split(':').map(Number);
        const isPM = /PM/.test(todayRec.clockIn);
        todayDate.setHours(isPM && h !== 12 ? h + 12 : (!isPM && h === 12 ? 0 : h), m, 0, 0);
        setClockInTime(todayDate);
      }
    }
  }, [weekLog]);

  // ── Fetch profile photo on mount ──────────────────────────────────────────
  useEffect(() => {
    async function fetchPhoto() {
      try {
        const data = await apiFetch('/employees/me/photo');
        setProfilePhoto(data.profilePhotoUrl ?? null);
      } catch {
        // no photo yet or auth error — stay null
      } finally {
        setPhotoLoading(false);
      }
    }
    fetchPhoto();
  }, []);

  // ── Load attendance records for the selected period ───────────────────────
  useEffect(() => {
    if (!user?.employeeId) { setWeekLoading(false); return; }
    setWeekLoading(true);
    const { start, end } = getPeriodBounds(viewMode, periodOffset);
    const from = toISODate(start);
    // Add one day to `to` so the backend's lte covers all records on the end date
    const toDate = new Date(end);
    toDate.setUTCDate(toDate.getUTCDate() + 1);
    const to = toISODate(toDate);
    apiFetch(`/attendance/${user.employeeId}?from=${from}&to=${to}`)
      .then((records: any[]) => setWeekLog(buildPeriodLog(Array.isArray(records) ? records : [], start, end)))
      .catch(() => setWeekLog(buildPeriodLog([], start, end)))
      .finally(() => setWeekLoading(false));
  }, [user?.employeeId, viewMode, periodOffset]);

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
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const stopUploadCamera = useCallback(() => {
    uploadStreamRef.current?.getTracks().forEach(t => t.stop());
    uploadStreamRef.current = null;
    if (uploadVideoRef.current) uploadVideoRef.current.srcObject = null;
  }, []);

  // ── Start webcam for profile photo capture ────────────────────────────────
  useEffect(() => {
    if (clockState !== 'upload_photo' || photoSource !== 'camera') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setUploadError('Camera is unavailable. This feature requires HTTPS — please upload a photo instead.');
      setPhotoSource('file');
      return;
    }
    let active = true;
    navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 480 }, height: { ideal: 480 }, facingMode: 'user' },
    }).then(stream => {
      if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
      uploadStreamRef.current = stream;
      if (uploadVideoRef.current) {
        uploadVideoRef.current.srcObject = stream;
        uploadVideoRef.current.play().catch(console.error);
      }
    }).catch(() => {
      if (active) {
        setUploadError('Camera access denied. Please allow camera permission.');
        setPhotoSource('file');
      }
    });
    return () => { active = false; stopUploadCamera(); };
  }, [photoSource, clockState, retakeKey, stopUploadCamera]);

  const captureUploadPhoto = () => {
    const video  = uploadVideoRef.current;
    const canvas = uploadCanvasRef.current;
    if (!video || !canvas) return;
    const MAX = 512;
    const vw = video.videoWidth  || 480;
    const vh = video.videoHeight || 480;
    const scale = Math.min(1, MAX / Math.max(vw, vh));
    canvas.width  = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    setUploadPreview(canvas.toDataURL('image/jpeg', 0.75));
    stopUploadCamera();
  };

  const startCamera = async () => {
    if (!profilePhoto) { setClockState('no_photo'); return; }
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera unavailable — this feature requires HTTPS. Contact your administrator.');
      return;
    }
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

  // ── Face verification via InsightFace (server-side) ──────────────────────
  const captureAndVerify = async () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    setClockState('capturing');
    const MAX = 640;
    const vw = video.videoWidth  || 480;
    const vh = video.videoHeight || 480;
    const scale = Math.min(1, MAX / Math.max(vw, vh));
    canvas.width  = Math.round(vw * scale);
    canvas.height = Math.round(vh * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL('image/jpeg', 0.85);
    setCapturedImg(imageData);
    stopCamera();
    setClockState('verifying');
    setVerifyError(null);

    try {
      const result = await apiFetch('/employees/me/verify-face', {
        method: 'POST',
        body: JSON.stringify({ capturedPhoto: imageData }),
      });

      if (result.error === 'no_face_in_target') {
        setVerifyError('No face detected. Please centre your face in the oval and ensure good lighting.');
        setClockState('failed');
        return;
      }
      if (result.error === 'no_face_in_reference' || result.error === 'no_profile_photo') {
        setVerifyError('Could not read your profile photo. Please re-upload a clear, front-facing photo.');
        setClockState('failed');
        return;
      }

      const similarity = Math.max(0, Math.round((result.similarity ?? 0) * 100));
      setConfidence(similarity);

      if (result.matched) {
        setClockState('success');
        // Call the actual attendance API now that identity is confirmed
        const todayIso = todayISO();
        const endpoint = isClockedIn ? '/attendance/clock-out' : '/attendance/clock-in';
        try {
          const rec = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({}) });
          const fmtT = (iso: string) => new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });

          if (!isClockedIn) {
            setIsClockedIn(true);
            setClockInTime(new Date(rec.clockIn));
            setWeekLog(prev => prev.map(r => r.isoDate === todayIso
              // PRE-EXISTING GAP, deliberately left as-is by the rebrand: this
              // read `rec.status === 'LATE' ? 'present' : 'present'`, so a late
              // clock-in has always been logged as plain "present".
              // AttendanceRecord['status'] has no 'late' member, so fixing it
              // means widening the union and updating the badge, the calendar
              // and attendanceUtils — a behaviour change, not a visual one. The
              // dead branch is removed so the gap is visible rather than looking
              // handled. Reported to the user.
              ? { ...r, clockIn: fmtT(rec.clockIn), status: 'present' as AttendanceRecord['status'] }
              : r
            ));
          } else {
            setIsClockedIn(false);
            const dur = rec.hoursWorked != null ? `${Math.floor(rec.hoursWorked)}h ${Math.round((rec.hoursWorked % 1) * 60)}m` : null;
            setWeekLog(prev => prev.map(r => r.isoDate === todayIso
              ? { ...r, clockOut: fmtT(rec.clockOut), duration: dur ?? r.duration }
              : r
            ));
          }
        } catch (clockErr: any) {
          setVerifyError(clockErr.message || 'Clock recorded but attendance save failed.');
        }
        setTimeout(() => {
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
      await apiFetch('/employees/me/photo', {
        method: 'POST',
        body: JSON.stringify({ profilePhotoUrl: uploadPreview }),
      });
      setProfilePhoto(uploadPreview);
      setUploadPreview(null);
      stopUploadCamera();
      setPhotoSource('file');
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


  return (
    <>
    <div className="flex flex-col gap-6 max-w-[1100px] mx-auto pb-20 animate-in fade-in duration-700">

      {/* ── Main Clock-in Card ──────────────────────────────────────────────── */}
      <div className="bg-[#0a0f1e] overflow-hidden border border-white/5">

        {/* Top: clock + status */}
        <div className="relative px-10 pt-10 pb-8 text-center border-b border-white/5">
          <div className="absolute inset-0 bg-gradient-to-br to-accent via-transparent to-page" />
          <div className="relative z-10">
            <p className="text-[9px] font-black text-accent uppercase tracking-[0.4em] mb-5">
              {user?.name ? `Welcome, ${user.name.split(' ')[0]}` : 'Employee Self-Service'} · Attendance
            </p>
            <LiveClock />
            <div className="mt-6 flex items-center justify-center">
              {isClockedIn ? (
                <span className="flex items-center gap-2 text-accent border-accent bg-accent px-4 py-1.5 border text-[10px] font-black uppercase tracking-widest">
                  <span className="w-2 h-2 bg-accent animate-pulse" />
                  Clocked In · {clockInTime?.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true })}
                </span>
              ) : (
                <span className="flex items-center gap-2 text-muted border-shadow bg-shadow px-4 py-1.5 border text-[10px] font-black uppercase tracking-widest">
                  <span className="w-2 h-2 bg-muted" />
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
                <div className="w-full max-w-md px-5 py-4 bg-ink border border-ink text-[11px] font-bold text-ink text-center">
                  {cameraError}
                </div>
              )}
              {photoLoading ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-10 h-10 border-4 border-accent border-accent animate-spin" />
                  <p className="text-[10px] font-black text-muted uppercase tracking-widest">Loading profile…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-5">
                  {/* Profile photo preview */}
                  <div className="flex flex-col items-center gap-2">
                    {profilePhoto ? (
                      <div className="relative">
                        <img src={profilePhoto} className="w-20 h-20 object-cover border-2 border-accent" alt="Profile" />
                        <div className="absolute -bottom-1.5 -right-1.5 w-6 h-6 bg-accent flex items-center justify-center">
                          <svg className="w-3 h-3 text-paper" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                        </div>
                      </div>
                    ) : (
                      <div className="w-20 h-20 bg-paper border border-white/8 flex items-center justify-center">
                        <svg className="w-9 h-9 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                        </svg>
                      </div>
                    )}
                    <p className="text-[9px] font-black text-muted uppercase tracking-widest">
                      {profilePhoto ? 'Face ID ready' : 'No profile photo'}
                    </p>
                  </div>

                  <div className="flex flex-col items-center gap-3">
                    <button
                      onClick={startCamera}
                      disabled={false}
                      className={`flex items-center gap-3 px-10 py-5  text-[11px] font-black uppercase tracking-widest transition-all active:scale-95  disabled:opacity-40 disabled:cursor-not-allowed ${
                        isClockedIn
                          ? 'bg-ink text-paper hover:bg-ink'
                          : 'bg-accent text-paper hover:bg-accent'
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
                      onClick={() => { setUploadPreview(null); setUploadError(null); setPhotoSource('file'); setClockState('upload_photo'); }}
                      className="text-[9px] font-black text-ink hover:text-accent uppercase tracking-widest transition-all"
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
              <div className="w-20 h-20 bg-highlight border border-highlight flex items-center justify-center">
                <svg className="w-10 h-10 text-ink" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
                </svg>
              </div>
              <div className="text-center max-w-xs">
                <p className="text-lg font-black text-ink uppercase tracking-widest">Profile Photo Required</p>
                <p className="text-[11px] font-bold text-muted mt-2 leading-relaxed">
                  Face ID clock-in requires a profile photo on file. Please upload a clear, front-facing photo of yourself.
                </p>
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => { setUploadPreview(null); setUploadError(null); setPhotoSource('file'); setClockState('upload_photo'); }}
                  className="px-4 sm:px-6 lg:px-8 py-4 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95"
                >
                  Add Profile Photo
                </button>
                <button onClick={() => setClockState('idle')} className="px-4 sm:px-6 lg:px-8 py-4 bg-paper border border-white/10 text-muted text-[10px] font-black uppercase tracking-widest hover:bg-paper transition-all">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* UPLOAD PHOTO state */}
          {clockState === 'upload_photo' && (
            <div className="flex flex-col items-center gap-6 py-4 max-w-sm mx-auto">
              <p className="label-form">
                {profilePhoto ? 'Update Profile Photo' : 'Add Profile Photo'}
              </p>

              {/* Source tabs */}
              <div className="flex bg-paper border border-white/10 p-0.5 gap-0.5 w-full">
                <button
                  onClick={() => { stopUploadCamera(); setUploadPreview(null); setPhotoSource('file'); }}
                  className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest  transition-all ${photoSource === 'file' ? 'bg-accent text-paper' : 'text-muted hover:text-muted'}`}
                >
                  Upload File
                </button>
                <button
                  onClick={() => { setUploadPreview(null); setPhotoSource('camera'); }}
                  className={`flex-1 py-2 text-[9px] font-black uppercase tracking-widest  transition-all ${photoSource === 'camera' ? 'bg-accent text-paper' : 'text-muted hover:text-muted'}`}
                >
                  Use Camera
                </button>
              </div>

              {/* File upload mode */}
              {photoSource === 'file' && (
                <div
                  className="relative w-52 h-52 border-2 border-dashed border-white/15 bg-paper flex items-center justify-center cursor-pointer hover:border-accent hover:bg-accent transition-all overflow-hidden"
                  onClick={() => uploadInputRef.current?.click()}
                >
                  {uploadPreview ? (
                    <img src={uploadPreview} className="w-full h-full object-cover" alt="Preview" />
                  ) : profilePhoto ? (
                    <>
                      <img src={profilePhoto} className="w-full h-full object-cover opacity-40" alt="Current" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <svg className="w-8 h-8 text-paper/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" /></svg>
                        <p className="text-[9px] font-black text-paper/60 mt-1 uppercase tracking-wider">Replace</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-ink">
                      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /></svg>
                      <p className="text-[9px] font-black uppercase tracking-wider text-center px-4">Click to select photo</p>
                    </div>
                  )}
                </div>
              )}

              {/* Camera capture mode */}
              {photoSource === 'camera' && (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative w-52 h-52 overflow-hidden border border-white/10 bg-shadow">
                    <video
                      ref={uploadVideoRef}
                      className="w-full h-full object-cover"
                      playsInline
                      muted
                      style={{ display: uploadPreview ? 'none' : 'block' }}
                    />
                    {uploadPreview && (
                      <img src={uploadPreview} className="w-full h-full object-cover" alt="Captured" />
                    )}
                    {!uploadPreview && (
                      <>
                        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                          <div className="w-32 h-40 border-2 border-accent" style={{ boxShadow: '0 0 0 9999px rgba(10,15,30,0.5)' }} />
                        </div>
                        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                          <span className="text-[9px] font-black text-accent uppercase tracking-widest bg-accent px-3 py-1 backdrop-">
                            Position face in oval
                          </span>
                        </div>
                      </>
                    )}
                    {uploadPreview && (
                      <div className="absolute inset-0 flex items-end justify-center pb-3">
                        <button
                          onClick={() => { setUploadPreview(null); setRetakeKey(k => k + 1); }}
                          className="px-4 py-1.5 bg-shadow text-paper text-[9px] font-black uppercase tracking-wider backdrop-"
                        >
                          Retake
                        </button>
                      </div>
                    )}
                  </div>
                  {!uploadPreview && (
                    <button
                      onClick={captureUploadPhoto}
                      className="px-4 sm:px-6 lg:px-8 py-3 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 18a8 8 0 110-16 8 8 0 010 16z" /></svg>
                      Capture
                    </button>
                  )}
                </div>
              )}

              <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFileChange} />

              {uploadError && (
                <p className="text-[10px] font-bold text-ink text-center">{uploadError}</p>
              )}

              <p className="text-[9px] font-bold text-muted text-center leading-relaxed px-4">
                Use a clear, front-facing photo with good lighting. This will be used for face verification during clock-in.
              </p>

              <div className="flex gap-3 w-full">
                <button
                  onClick={saveProfilePhoto}
                  disabled={!uploadPreview || uploadSaving}
                  className="flex-1 py-4 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {uploadSaving ? 'Saving…' : 'Save Photo'}
                </button>
                <button
                  onClick={() => { stopUploadCamera(); setPhotoSource('file'); setClockState('idle'); }}
                  className="flex-1 py-4 bg-paper border border-white/10 text-muted text-[10px] font-black uppercase tracking-widest hover:bg-paper transition-all"
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
                <p className="text-[9px] font-black text-muted uppercase tracking-widest">Live Camera</p>
                <div className="relative overflow-hidden border border-white/10 bg-shadow" style={{ width: 280, height: 280 }}>
                  <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-44 h-52 border-2 border-accent" style={{ boxShadow: '0 0 0 9999px rgba(10,15,30,0.5)' }} />
                  </div>
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                    <span className="text-[9px] font-black text-accent uppercase tracking-widest bg-accent px-3 py-1 backdrop-">
                      Position face in oval
                    </span>
                  </div>
                </div>
                <button
                  onClick={captureAndVerify}
                  className="mt-1 px-10 py-4 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" /><path d="M12 2a10 10 0 100 20A10 10 0 0012 2zm0 18a8 8 0 110-16 8 8 0 010 16z" /></svg>
                  Capture & Verify
                </button>
              </div>

              {/* VS divider */}
              <div className="flex lg:flex-col items-center gap-2">
                <div className="w-16 h-px lg:w-px lg:h-16 bg-paper" />
                <span className="text-[9px] font-black text-ink uppercase">vs</span>
                <div className="w-16 h-px lg:w-px lg:h-16 bg-paper" />
              </div>

              {/* Profile photo */}
              <div className="flex flex-col items-center gap-3">
                <p className="text-[9px] font-black text-muted uppercase tracking-widest">Profile Photo</p>
                <div className="relative overflow-hidden border border-white/10 bg-shadow" style={{ width: 280, height: 280 }}>
                  {profilePhoto ? (
                    <img src={profilePhoto} className="w-full h-full object-cover" alt="Profile" />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-ink gap-3">
                      <svg className="w-16 h-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" /></svg>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-center px-4 leading-relaxed">No profile photo</span>
                    </div>
                  )}
                </div>
                <button onClick={() => { stopCamera(); setClockState('idle'); }} className="text-[9px] font-black text-muted hover:text-ink uppercase tracking-widest transition-all">
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
                  <p className="text-[9px] font-black text-muted uppercase tracking-widest">Captured</p>
                  <div className="overflow-hidden border border-white/10" style={{ width: 160, height: 160 }}>
                    {capturedImg
                      ? <img src={capturedImg} className="w-full h-full object-cover" alt="Captured" />
                      : <div className="w-full h-full bg-shadow animate-pulse" />
                    }
                  </div>
                </div>

                {/* Spinner */}
                <div className="flex flex-col items-center gap-4">
                  <div className="relative w-20 h-20">
                    <div className="absolute inset-0 border-4 border-accent border-accent animate-spin" />
                    <div className="absolute inset-3 border-4 border-shadow border-accent animate-spin [animation-direction:reverse] [animation-duration:0.7s]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0119.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 004.5 10.5a7.464 7.464 0 01-1.15 3.993m1.989 3.559A11.209 11.209 0 008.25 10.5a3.75 3.75 0 117.5 0c0 .527-.021 1.049-.064 1.565" /></svg>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-black text-paper uppercase tracking-widest">Analysing face…</p>
                    <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1">Comparing against profile record</p>
                  </div>
                </div>

                {/* Profile photo reference */}
                <div className="flex flex-col items-center gap-2">
                  <p className="text-[9px] font-black text-muted uppercase tracking-widest">Profile</p>
                  <div className="overflow-hidden border border-white/10 bg-shadow" style={{ width: 160, height: 160 }}>
                    {profilePhoto
                      ? <img src={profilePhoto} className="w-full h-full object-cover" alt="Profile reference" />
                      : <div className="w-full h-full bg-shadow" />
                    }
                  </div>
                </div>
              </div>

              {/* Scanning bars */}
              <div className="flex items-end gap-1 h-8">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="w-1.5 bg-accent animate-pulse" style={{ height: `${20 + Math.sin(i) * 16}px`, animationDelay: `${i * 80}ms` }} />
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
                    <img src={capturedImg} className="w-28 h-28 object-cover border-2 border-accent" alt="Verified" />
                    <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-accent flex items-center justify-center">
                      <svg className="w-4 h-4 text-paper" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                    </div>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-2xl font-black text-accent uppercase tracking-widest">Identity Verified</p>
                  <p className="text-[11px] font-bold text-muted uppercase tracking-widest mt-2">
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
                    <img src={capturedImg} className="w-28 h-28 object-cover border-2 border-ink" alt="Unverified" />
                    <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-ink flex items-center justify-center">
                      <svg className="w-4 h-4 text-paper" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </div>
                  </div>
                )}
                <div className="text-center">
                  <p className="text-2xl font-black text-ink uppercase tracking-widest">Verification Failed</p>
                  <p className="text-[11px] font-bold text-muted uppercase tracking-widest mt-2">
                    {verifyError ?? `Match score ${confidence}% — face not recognised. Please try again.`}
                  </p>
                </div>
              </div>
              <div className="flex gap-4 mt-2">
                <button onClick={retry} className="px-4 sm:px-6 lg:px-8 py-4 bg-accent text-paper text-[10px] font-black uppercase tracking-widest hover:bg-accent transition-all active:scale-95">
                  Try Again
                </button>
                <button
                  onClick={() => { retry(); setPhotoSource('file'); setClockState('upload_photo'); setUploadPreview(null); setUploadError(null); }}
                  className="px-4 sm:px-6 lg:px-8 py-4 bg-paper border border-white/10 text-muted text-[10px] font-black uppercase tracking-widest hover:bg-paper transition-all"
                >
                  Update Photo
                </button>
              </div>
            </div>
          )}

          {/* Off-screen canvas for capture */}
          <canvas ref={canvasRef} style={{ position: 'absolute', top: '-9999px', left: '-9999px', width: 0, height: 0 }} />
          <canvas ref={uploadCanvasRef} style={{ position: 'absolute', top: '-9999px', left: '-9999px', width: 0, height: 0 }} />
        </div>
      </div>

      {/* ── Attendance Log ───────────────────────────────────────────────────── */}
      {(() => {
        const { label } = getPeriodBounds(viewMode, periodOffset);
        const workDays  = weekLog.filter(r => r.status !== 'weekend');
        const presentCount = weekLog.filter(r => r.status === 'present' || r.status === 'half').length;
        const expectedDays = workDays.length;

        const VIEW_TABS: { key: ViewMode; label: string }[] = [
          { key: 'work-week', label: 'Work Week' },
          { key: 'week',      label: 'Week' },
          { key: 'bi-weekly', label: 'Bi-weekly' },
          { key: 'month',     label: 'Month' },
        ];

        /**
         * Ordered by how much attention the state deserves, since the palette
         * has no five-way hue vocabulary: unexplained absence is filled ink and
         * therefore heaviest, authorised leave is filled accent, an ordinary
         * present day is a quiet outline, and the weekend recedes entirely.
         *
         * Straight token mapping had rendered 'present' and 'leave' identically
         * — the two most common states on the calendar.
         */
        const statusBadge = (s: AttendanceRecord['status']) => {
          if (s === 'present')  return { cls: 'bg-paper text-accent border-accent',     txt: 'Present'  };
          if (s === 'half')     return { cls: 'bg-paper text-ink border-highlight',     txt: 'Half Day' };
          if (s === 'leave')    return { cls: 'bg-accent text-paper border-accent',     txt: 'On Leave' };
          if (s === 'weekend')  return { cls: 'bg-page text-muted border-rule',         txt: 'Weekend'  };
          return                       { cls: 'bg-ink text-paper border-ink',           txt: 'Absent'   };
        };

        // ── Month: calendar grid ──────────────────────────────────────────────
        if (viewMode === 'month') {
          const { start } = getPeriodBounds('month', periodOffset);
          // group rows into weeks (7-day chunks starting Mon). All dates are
          // UTC-midnight civil-date anchors → use UTC getters/setters throughout.
          const firstMonday = getMondayOf(start);
          const recMap = new Map(weekLog.map(r => [r.isoDate, r]));
          const weeks: (AttendanceRecord | null)[][] = [];
          const cur = new Date(firstMonday);
          const { end: mEnd } = getPeriodBounds('month', periodOffset);
          while (cur <= mEnd || weeks.length === 0) {
            const week: (AttendanceRecord | null)[] = [];
            for (let d = 0; d < 7; d++) {
              const iso = toISODate(cur);
              const rec = recMap.get(iso) ?? null;
              // days outside the current month
              const inMonth = cur.getUTCMonth() === start.getUTCMonth();
              week.push(inMonth ? (rec ?? {
                date: cur.toLocaleDateString('en-SG', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }),
                isoDate: iso, dayOfWeek: cur.getUTCDay(),
                clockIn: null, clockOut: null, duration: null,
                status: (cur.getUTCDay() === 0 || cur.getUTCDay() === 6) ? 'weekend' : 'absent',
              } as AttendanceRecord) : null);
              cur.setUTCDate(cur.getUTCDate() + 1);
            }
            weeks.push(week);
            if (cur > mEnd) break;
          }

          const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
          // Leave is DASHED and its dot HOLLOW; a present day is solid. Straight
          // token mapping had made the two identical, and on a month grid those
          // are the two states a reader is actually comparing.
          const cellColor = (s: AttendanceRecord['status'] | undefined) => {
            if (!s)              return 'bg-page border-transparent';
            if (s === 'present') return 'bg-paper border-accent';
            if (s === 'half')    return 'bg-paper border-highlight';
            if (s === 'leave')   return 'bg-page border-accent border-dashed';
            if (s === 'weekend') return 'bg-page border-rule';
            return 'bg-page border-ink';
          };
          const dotColor = (s: AttendanceRecord['status'] | undefined) => {
            if (s === 'present') return 'bg-accent';
            if (s === 'half')    return 'bg-highlight';
            if (s === 'leave')   return 'bg-paper border border-accent';
            return 'bg-transparent';
          };

          return (
            <div className="bg-paper border border-rule overflow-hidden">
              {/* Header */}
              <div className="px-4 sm:px-6 lg:px-8 py-5 border-b border-rule bg-page">
                <div className="flex flex-wrap items-center gap-4">
                  {/* View tabs */}
                  <div className="flex bg-page p-0.5 gap-0.5">
                    {VIEW_TABS.map(t => (
                      <button key={t.key} onClick={() => { setViewMode(t.key); setPeriodOffset(0); }}
                        className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest  transition-all ${viewMode === t.key ? 'bg-paper text-ink' : 'text-muted hover:text-ink'}`}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {/* Nav */}
                  <div className="flex items-center gap-2 ml-auto">
                    <button onClick={() => setPeriodOffset(p => p - 1)}
                      className="w-8 h-8 flex items-center justify-center bg-page hover:bg-rule transition-all text-ink">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="text-[10px] font-black text-ink uppercase tracking-widest min-w-[140px] text-center">{label}</span>
                    <button onClick={() => setPeriodOffset(p => p + 1)} disabled={periodOffset >= 0}
                      className="w-8 h-8 flex items-center justify-center bg-page hover:bg-rule transition-all text-ink disabled:opacity-30 disabled:cursor-not-allowed">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                    </button>
                  </div>
                  {!weekLoading && (
                    <div className="px-3 py-1.5 bg-page border border-accent">
                      <p className="text-[9px] font-black text-accent uppercase tracking-widest">{presentCount} / {expectedDays} days</p>
                    </div>
                  )}
                </div>
              </div>
              {/* Calendar grid */}
              <div className="p-4 sm:p-6">
                <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                  {dayHeaders.map(d => (
                    <div key={d} className="text-center label-form py-1">{d}</div>
                  ))}
                </div>
                {weekLoading ? (
                  <div className="grid grid-cols-7 gap-1.5">
                    {Array.from({ length: 35 }).map((_, i) => <div key={i} className="h-14 bg-page animate-pulse" />)}
                  </div>
                ) : (
                  weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-1.5 mb-1.5">
                      {week.map((rec, di) => {
                        if (!rec) return <div key={di} className="h-14 bg-page" />;
                        const dayNum = rec.isoDate.slice(8);
                        const isToday = rec.isoDate === todayISO();
                        return (
                          <div key={di} className={`h-14  border px-2 py-1.5 flex flex-col justify-between transition-all ${cellColor(rec.status)} ${isToday ? 'ring-2 ring-accent ring-offset-1' : ''}`}>
                            <div className="flex items-center justify-between">
                              <span className={`text-[10px] font-black ${isToday ? 'text-accent' : 'text-ink'}`}>{dayNum}</span>
                              {rec.status !== 'absent' && rec.status !== 'weekend' && (
                                <span className={`w-1.5 h-1.5  ${dotColor(rec.status)}`} />
                              )}
                            </div>
                            <span className="text-[8px] font-black uppercase tracking-wide text-muted leading-none">
                              {rec.status === 'present' ? rec.duration ?? 'Present' : rec.status === 'half' ? 'Half Day' : rec.status === 'leave' ? 'Leave' : rec.status === 'weekend' ? '' : 'Absent'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            </div>
          );
        }

        // ── List view (work-week / week / bi-weekly) ───────────────────────────
        const compact = viewMode === 'bi-weekly';
        return (
          <div className="bg-paper border border-rule overflow-hidden">
            {/* Header */}
            <div className="px-4 sm:px-6 lg:px-8 py-5 border-b border-rule bg-page">
              <div className="flex flex-wrap items-center gap-4">
                {/* View tabs */}
                <div className="flex bg-page p-0.5 gap-0.5">
                  {VIEW_TABS.map(t => (
                    <button key={t.key} onClick={() => { setViewMode(t.key); setPeriodOffset(0); }}
                      className={`px-3 py-1.5 text-[9px] font-black uppercase tracking-widest  transition-all ${viewMode === t.key ? 'bg-paper text-ink' : 'text-muted hover:text-ink'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
                {/* Nav */}
                <div className="flex items-center gap-2 ml-auto">
                  <button onClick={() => setPeriodOffset(p => p - 1)}
                    className="w-8 h-8 flex items-center justify-center bg-page hover:bg-rule transition-all text-ink">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                  </button>
                  <span className="text-[10px] font-black text-ink uppercase tracking-widest min-w-[160px] text-center">{label}</span>
                  <button onClick={() => setPeriodOffset(p => p + 1)} disabled={periodOffset >= 0}
                    className="w-8 h-8 flex items-center justify-center bg-page hover:bg-rule transition-all text-ink disabled:opacity-30 disabled:cursor-not-allowed">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                  </button>
                </div>
                {!weekLoading && (
                  <div className="px-3 py-1.5 bg-page border border-accent">
                    <p className="text-[9px] font-black text-accent uppercase tracking-widest">{presentCount} / {expectedDays} days</p>
                  </div>
                )}
              </div>
            </div>
            {/* Rows */}
            <div className="divide-y divide-rule">
              {weekLoading ? (
                Array.from({ length: viewMode === 'work-week' ? 5 : 7 }).map((_, i) => (
                  <div key={i} className="flex items-center px-4 sm:px-6 lg:px-8 py-4 animate-pulse">
                    <div className="w-28 h-4 bg-page" />
                    <div className="flex-1 ml-6 h-4 bg-page" />
                  </div>
                ))
              ) : weekLog.map((rec) => {
                const isToday = rec.isoDate === todayISO();
                const badge = statusBadge(rec.status);
                const isWeekendRow = rec.status === 'weekend';
                return (
                  <div key={rec.isoDate} className={`flex items-center px-4 sm:px-6 lg:px-8 transition-all ${compact ? 'py-3' : 'py-4'} ${isToday ? 'bg-page' : 'hover:bg-page'} ${isWeekendRow ? 'opacity-50' : ''}`}>
                    <div className={`${compact ? 'w-24' : 'w-32'} flex items-center gap-2`}>
                      {isToday && <span className="w-1.5 h-1.5 bg-accent shrink-0" />}
                      <p className={`font-black text-ink uppercase tracking-tight ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{rec.date}</p>
                    </div>
                    {isWeekendRow ? (
                      <p className="flex-1 text-[9px] font-bold text-muted uppercase tracking-widest">Weekend</p>
                    ) : compact ? (
                      <div className="flex-1 flex items-center gap-4">
                        <p className="text-[10px] font-black text-ink">{rec.clockIn ?? '—'}</p>
                        <span className="text-muted text-[10px]">→</span>
                        <p className="text-[10px] font-black text-ink">{rec.clockOut ?? '—'}</p>
                        {rec.duration && <p className="text-[10px] font-bold text-accent ml-2">{rec.duration}</p>}
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center gap-6">
                        <div className="flex flex-col">
                          <p className="label-form">Clock In</p>
                          <p className="text-xs font-black text-ink mt-0.5">{rec.clockIn ?? '—'}</p>
                        </div>
                        <div className="flex flex-col">
                          <p className="label-form">Clock Out</p>
                          <p className="text-xs font-black text-ink mt-0.5">{rec.clockOut ?? '—'}</p>
                        </div>
                        <div className="flex flex-col">
                          <p className="label-form">Duration</p>
                          <p className="text-xs font-bold text-accent mt-0.5">{rec.duration ?? '—'}</p>
                        </div>
                      </div>
                    )}
                    <span className={`text-[8px] font-black uppercase tracking-widest px-2.5 py-1  border ${badge.cls}`}>
                      {badge.txt}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
    </div>
    </>
  );
}

// ─── Entry point — always the employee self-service clock-in view ─────────────

export default function AttendancePage() {
  return <EmployeeAttendanceView />;
}
