'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiFetch } from '@/lib/api';
import { getMondayOf, getPeriodBounds, buildPeriodLog } from '@/lib/attendanceUtils';
import type { ViewMode, AttendanceRecord, ApiRecord } from '@/lib/attendanceUtils';
import { todayISO, toISODate } from '@/lib/timezone';
import { PageHeader, Card, CardHeader, Tabs, Badge, Button, Icon } from '@/components/ui';

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
      <p className="text-[44px] sm:text-[56px] font-extrabold tracking-[-0.03em] leading-none text-ink tabular-nums">{timeStr}</p>
      <p className="text-sm text-muted mt-3">{dateStr}</p>
    </div>
  );
}

/** The dimmed mask around the face guide — ink at half strength, not a legacy navy. */
const FACE_MASK = '0 0 0 9999px rgba(26,26,24,0.55)';

/** Framed photo/video box used by every camera state. */
function Frame({ size, children, className = '' }: { size: number; children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-card border border-rule bg-ink ${className}`} style={{ width: size, height: size, maxWidth: '100%' }}>
      {children}
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

  const openUpload = () => { setUploadPreview(null); setUploadError(null); setPhotoSource('file'); setClockState('upload_photo'); };

  const clockedInLabel = clockInTime?.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true });

  return (
    <>
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Attendance"
        subtitle={user?.name ? `Welcome back, ${user.name.split(' ')[0]}. Clock in and out with Face ID.` : 'Clock in and out with Face ID.'}
        actions={
          isClockedIn
            ? <Badge tone="ok"><span className="w-1.5 h-1.5 rounded-full bg-ok mr-1.5 animate-pulse" aria-hidden="true" />Clocked in{clockedInLabel ? ` · ${clockedInLabel}` : ''}</Badge>
            : <Badge tone="neutral">Not clocked in</Badge>
        }
      />

      {/* ── Main clock-in card ─────────────────────────────────────────────── */}
      <Card padding="p-0" className="overflow-hidden">
        <div className="px-5 py-8 sm:py-10 border-b border-rule">
          <LiveClock />
        </div>

        {/* Camera / verification panel */}
        <div className="px-5 py-8 sm:px-8">

          {/* IDLE state */}
          {clockState === 'idle' && (
            <div className="flex flex-col items-center gap-6">
              {cameraError && (
                <div className="flex items-start gap-2.5 w-full max-w-md px-3.5 py-3 rounded-control bg-danger-bg text-sm text-danger">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0" />{cameraError}
                </div>
              )}
              {photoLoading ? (
                <div className="flex flex-col items-center gap-3 py-4">
                  <div className="w-8 h-8 border-4 border-accent border-t-accent animate-spin rounded-full" />
                  <p className="text-sm text-muted">Loading your profile…</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-5">
                  {/* Profile photo preview */}
                  <div className="flex flex-col items-center gap-2">
                    {profilePhoto ? (
                      <div className="relative">
                        <img src={profilePhoto} className="w-20 h-20 object-cover rounded-full border-2 border-accent" alt="Profile" />
                        <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-6 h-6 rounded-full bg-accent text-on-accent border-2 border-paper">
                          <Icon name="check" size={12} strokeWidth={3} />
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center w-20 h-20 rounded-full bg-pill text-faint">
                        <Icon name="user" size={34} strokeWidth={1.5} />
                      </div>
                    )}
                    <p className="text-xs font-semibold text-muted">{profilePhoto ? 'Face ID ready' : 'No profile photo'}</p>
                  </div>

                  <div className="flex flex-col items-center gap-3">
                    <Button
                      variant="primary"
                      icon="camera"
                      onClick={startCamera}
                      disabled={false}
                      className="h-12 px-8 text-[15px]"
                    >
                      {isClockedIn ? 'Clock out with Face ID' : 'Clock in with Face ID'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={openUpload}>
                      {profilePhoto ? 'Update profile photo' : 'Add profile photo'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* NO PHOTO prompt */}
          {clockState === 'no_photo' && (
            <div className="flex flex-col items-center gap-5 py-2">
              <div className="flex items-center justify-center w-14 h-14 rounded-control bg-warn-bg text-warn">
                <Icon name="user" size={28} strokeWidth={1.5} />
              </div>
              <div className="text-center max-w-sm">
                <p className="text-[17px] font-bold text-ink">Profile photo needed</p>
                <p className="text-sm text-muted mt-1.5 leading-relaxed">
                  Face ID clock-in compares you against a profile photo on file. Add a clear, front-facing photo of yourself to continue.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2.5">
                <Button variant="secondary" onClick={() => setClockState('idle')}>Cancel</Button>
                <Button variant="primary" icon="upload" onClick={openUpload}>Add profile photo</Button>
              </div>
            </div>
          )}

          {/* UPLOAD PHOTO state */}
          {clockState === 'upload_photo' && (
            <div className="flex flex-col items-center gap-5 py-2 w-full max-w-sm mx-auto">
              <p className="text-[17px] font-bold text-ink">{profilePhoto ? 'Update profile photo' : 'Add profile photo'}</p>

              {/* Source toggle */}
              <div className="flex w-full p-1 rounded-full bg-pill" role="radiogroup" aria-label="Photo source">
                {([['file', 'Upload a file'], ['camera', 'Use camera']] as const).map(([src, label]) => (
                  <button
                    key={src}
                    type="button"
                    role="radio"
                    aria-checked={photoSource === src}
                    onClick={() => { if (src === 'file') { stopUploadCamera(); } setUploadPreview(null); setPhotoSource(src); }}
                    className={`flex-1 h-8 rounded-full text-[13px] font-semibold transition-colors ${photoSource === src ? 'bg-paper text-ink shadow-card' : 'text-muted hover:text-ink'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* File upload mode */}
              {photoSource === 'file' && (
                <div
                  role="button"
                  tabIndex={0}
                  className="relative w-52 h-52 max-w-full rounded-card border-2 border-dashed border-rule bg-page flex items-center justify-center cursor-pointer hover:border-accent transition-colors overflow-hidden"
                  onClick={() => uploadInputRef.current?.click()}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') uploadInputRef.current?.click(); }}
                >
                  {uploadPreview ? (
                    <img src={uploadPreview} className="w-full h-full object-cover" alt="Preview" />
                  ) : profilePhoto ? (
                    <>
                      <img src={profilePhoto} className="w-full h-full object-cover opacity-40" alt="Current" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-ink">
                        <Icon name="upload" size={26} />
                        <p className="text-xs font-semibold">Replace photo</p>
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-muted">
                      <Icon name="upload" size={30} strokeWidth={1.5} />
                      <p className="text-xs font-semibold text-center px-4">Click to choose a photo</p>
                    </div>
                  )}
                </div>
              )}

              {/* Camera capture mode */}
              {photoSource === 'camera' && (
                <div className="flex flex-col items-center gap-3">
                  <Frame size={208}>
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
                          <div className="w-32 h-40 rounded-full border-2 border-accent" style={{ boxShadow: FACE_MASK }} />
                        </div>
                        <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                          <span className="px-2.5 h-6 inline-flex items-center rounded-full bg-paper text-xs font-semibold text-ink">Centre your face in the oval</span>
                        </div>
                      </>
                    )}
                    {uploadPreview && (
                      <div className="absolute inset-0 flex items-end justify-center pb-3">
                        <Button size="sm" variant="secondary" icon="refresh" onClick={() => { setUploadPreview(null); setRetakeKey(k => k + 1); }}>Retake</Button>
                      </div>
                    )}
                  </Frame>
                  {!uploadPreview && (
                    <Button variant="primary" icon="camera" onClick={captureUploadPhoto}>Capture</Button>
                  )}
                </div>
              )}

              <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoFileChange} />

              {uploadError && (
                <div className="flex items-start gap-2.5 w-full px-3.5 py-3 rounded-control bg-danger-bg text-sm text-danger">
                  <Icon name="alert" size={16} className="mt-0.5 shrink-0" />{uploadError}
                </div>
              )}

              <p className="text-xs text-muted text-center leading-relaxed">
                Use a clear, front-facing photo with good lighting. It is only used to verify you at clock-in.
              </p>

              <div className="flex gap-2.5 w-full">
                <Button variant="secondary" className="flex-1" onClick={() => { stopUploadCamera(); setPhotoSource('file'); setClockState('idle'); }}>Cancel</Button>
                <Button variant="primary" className="flex-1" onClick={saveProfilePhoto} disabled={!uploadPreview || uploadSaving}>
                  {uploadSaving ? 'Saving…' : 'Save photo'}
                </Button>
              </div>
            </div>
          )}

          {/* CAMERA state */}
          {clockState === 'camera' && (
            <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 items-center justify-center">
              {/* Live camera */}
              <div className="flex flex-col items-center gap-3">
                <p className="text-xs font-semibold text-muted">Live camera</p>
                <Frame size={280}>
                  <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-44 h-52 rounded-full border-2 border-accent" style={{ boxShadow: FACE_MASK }} />
                  </div>
                  <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                    <span className="px-2.5 h-6 inline-flex items-center rounded-full bg-paper text-xs font-semibold text-ink">Centre your face in the oval</span>
                  </div>
                </Frame>
                <Button variant="primary" icon="camera" onClick={captureAndVerify} className="mt-1">Capture and verify</Button>
              </div>

              {/* Divider */}
              <div className="flex lg:flex-col items-center gap-2 text-faint">
                <div className="w-12 h-px lg:w-px lg:h-12 bg-rule" />
                <span className="text-xs font-semibold">vs</span>
                <div className="w-12 h-px lg:w-px lg:h-12 bg-rule" />
              </div>

              {/* Profile photo */}
              <div className="flex flex-col items-center gap-3">
                <p className="text-xs font-semibold text-muted">Profile photo</p>
                <Frame size={280}>
                  {profilePhoto ? (
                    <img src={profilePhoto} className="w-full h-full object-cover" alt="Profile" />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-faint">
                      <Icon name="user" size={48} strokeWidth={1} />
                      <span className="text-xs font-semibold">No profile photo</span>
                    </div>
                  )}
                </Frame>
                <Button variant="ghost" size="sm" onClick={() => { stopCamera(); setClockState('idle'); }}>Cancel</Button>
              </div>
            </div>
          )}

          {/* CAPTURING / VERIFYING state */}
          {(clockState === 'verifying' || clockState === 'capturing') && (
            <div className="flex flex-col items-center gap-6 py-2">
              <div className="flex flex-wrap justify-center gap-6 sm:gap-8 items-center">
                {/* Captured frame */}
                <div className="flex flex-col items-center gap-2">
                  <p className="text-xs font-semibold text-muted">Captured</p>
                  <Frame size={140}>
                    {capturedImg
                      ? <img src={capturedImg} className="w-full h-full object-cover" alt="Captured" />
                      : <div className="w-full h-full bg-pill animate-pulse" />
                    }
                  </Frame>
                </div>

                {/* Spinner */}
                <div className="flex flex-col items-center gap-4">
                  <div className="relative w-16 h-16">
                    <div className="absolute inset-0 border-4 border-tint border-t-accent animate-spin rounded-full" />
                    <div className="absolute inset-0 flex items-center justify-center text-accent">
                      <Icon name="user" size={24} strokeWidth={1.5} />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-[15.5px] font-bold text-ink">Checking your face…</p>
                    <p className="text-[13px] text-muted mt-0.5">Comparing against your profile photo</p>
                  </div>
                </div>

                {/* Profile photo reference */}
                <div className="flex flex-col items-center gap-2">
                  <p className="text-xs font-semibold text-muted">Profile</p>
                  <Frame size={140}>
                    {profilePhoto
                      ? <img src={profilePhoto} className="w-full h-full object-cover" alt="Profile reference" />
                      : <div className="w-full h-full bg-pill" />
                    }
                  </Frame>
                </div>
              </div>
            </div>
          )}

          {/* SUCCESS state */}
          {clockState === 'success' && (
            <div className="flex flex-col items-center gap-6 py-2">
              <div className="flex flex-col sm:flex-row gap-6 items-center">
                {capturedImg && (
                  <div className="relative">
                    <img src={capturedImg} className="w-28 h-28 object-cover rounded-card border-2 border-ok" alt="Verified" />
                    <span className="absolute -bottom-2 -right-2 flex items-center justify-center w-8 h-8 rounded-full bg-ok text-on-accent border-2 border-paper">
                      <Icon name="check" size={16} strokeWidth={3} />
                    </span>
                  </div>
                )}
                <div className="text-center sm:text-left">
                  <p className="text-[22px] font-extrabold tracking-[-0.02em] text-ok">Identity verified</p>
                  <p className="text-sm text-muted mt-1 tabular-nums">
                    Match score {confidence}% · {isClockedIn ? 'Clock-out' : 'Clock-in'} recorded
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* FAILED state */}
          {clockState === 'failed' && (
            <div className="flex flex-col items-center gap-6 py-2">
              <div className="flex flex-col sm:flex-row gap-6 items-center">
                {capturedImg && (
                  <div className="relative">
                    <img src={capturedImg} className="w-28 h-28 object-cover rounded-card border-2 border-danger" alt="Unverified" />
                    <span className="absolute -bottom-2 -right-2 flex items-center justify-center w-8 h-8 rounded-full bg-danger text-on-accent border-2 border-paper">
                      <Icon name="x" size={16} strokeWidth={2.5} />
                    </span>
                  </div>
                )}
                <div className="text-center sm:text-left max-w-sm">
                  <p className="text-[22px] font-extrabold tracking-[-0.02em] text-danger">Verification failed</p>
                  <p className="text-sm text-muted mt-1">
                    {verifyError ?? `Match score ${confidence}% — face not recognised. Please try again.`}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap justify-center gap-2.5">
                <Button variant="secondary" icon="upload" onClick={() => { retry(); setPhotoSource('file'); setClockState('upload_photo'); setUploadPreview(null); setUploadError(null); }}>
                  Update photo
                </Button>
                <Button variant="primary" icon="refresh" onClick={retry}>Try again</Button>
              </div>
            </div>
          )}

          {/* Off-screen canvas for capture */}
          <canvas ref={canvasRef} style={{ position: 'absolute', top: '-9999px', left: '-9999px', width: 0, height: 0 }} />
          <canvas ref={uploadCanvasRef} style={{ position: 'absolute', top: '-9999px', left: '-9999px', width: 0, height: 0 }} />
        </div>
      </Card>

      {/* ── Attendance log ─────────────────────────────────────────────────── */}
      {(() => {
        const { label } = getPeriodBounds(viewMode, periodOffset);
        const workDays  = weekLog.filter(r => r.status !== 'weekend');
        const presentCount = weekLog.filter(r => r.status === 'present' || r.status === 'half').length;
        const expectedDays = workDays.length;

        const VIEW_TABS: { id: ViewMode; label: string }[] = [
          { id: 'work-week', label: 'Work week' },
          { id: 'week',      label: 'Week' },
          { id: 'bi-weekly', label: 'Bi-weekly' },
          { id: 'month',     label: 'Month' },
        ];

        /**
         * One tone per state, and a WORD on every pill: an unexplained absence
         * is the only red on the screen, a half day is a warning, authorised
         * leave is the accent, an ordinary present day is the quiet ok, and the
         * weekend recedes to neutral.
         *
         * Straight token mapping had rendered 'present' and 'leave' identically
         * — the two most common states on the calendar.
         */
        const statusBadge = (s: AttendanceRecord['status']): { tone: 'ok' | 'warn' | 'accent' | 'neutral' | 'danger'; txt: string } => {
          if (s === 'present')  return { tone: 'ok',      txt: 'Present'  };
          if (s === 'half')     return { tone: 'warn',    txt: 'Half day' };
          if (s === 'leave')    return { tone: 'accent',  txt: 'On leave' };
          if (s === 'weekend')  return { tone: 'neutral', txt: 'Weekend'  };
          return                       { tone: 'danger',  txt: 'Absent'   };
        };

        const toolbar = (
          <div className="flex flex-col gap-3 px-5 pt-4 sm:px-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
              <CardHeader title="Attendance log" caption={label} className="mb-0" />
              <div className="flex items-center gap-2 shrink-0">
                {!weekLoading && <Badge tone="accent" className="mr-1 tabular-nums">{presentCount} / {expectedDays} days</Badge>}
                <Button variant="secondary" aria-label="Previous period" onClick={() => setPeriodOffset(p => p - 1)}>
                  <Icon name="chevronRight" size={16} className="rotate-180" />
                </Button>
                <Button variant="secondary" onClick={() => setPeriodOffset(0)} disabled={periodOffset === 0}>Current</Button>
                <Button variant="secondary" aria-label="Next period" onClick={() => setPeriodOffset(p => p + 1)} disabled={periodOffset >= 0}>
                  <Icon name="chevronRight" size={16} />
                </Button>
              </div>
            </div>
            <Tabs items={VIEW_TABS} active={viewMode} onChange={(m) => { setViewMode(m); setPeriodOffset(0); }} />
          </div>
        );

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
            if (s === 'present') return 'bg-paper border-ok';
            if (s === 'half')    return 'bg-paper border-warn';
            if (s === 'leave')   return 'bg-tint border-accent border-dashed';
            if (s === 'weekend') return 'bg-page border-rule';
            return 'bg-page border-danger/50';
          };
          const dotColor = (s: AttendanceRecord['status'] | undefined) => {
            if (s === 'present') return 'bg-ok';
            if (s === 'half')    return 'bg-warn';
            if (s === 'leave')   return 'bg-paper border border-accent';
            return 'bg-transparent';
          };
          const cellText = (r: AttendanceRecord) =>
            r.status === 'present' ? r.duration ?? 'Present' : r.status === 'half' ? 'Half day' : r.status === 'leave' ? 'Leave' : r.status === 'weekend' ? '' : 'Absent';

          return (
            <Card padding="p-0" className="overflow-hidden">
              {toolbar}
              {/* Calendar grid */}
              <div className="p-4 sm:p-6">
                <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                  {dayHeaders.map(d => (
                    <div key={d} className="text-center text-xs font-bold text-muted py-1">{d}</div>
                  ))}
                </div>
                {weekLoading ? (
                  <div className="grid grid-cols-7 gap-1.5">
                    {Array.from({ length: 35 }).map((_, i) => <div key={i} className="h-16 rounded-control bg-pill animate-pulse" />)}
                  </div>
                ) : (
                  weeks.map((week, wi) => (
                    <div key={wi} className="grid grid-cols-7 gap-1.5 mb-1.5">
                      {week.map((rec, di) => {
                        if (!rec) return <div key={di} className="h-16 rounded-control bg-page" />;
                        const dayNum = rec.isoDate.slice(8);
                        const isToday = rec.isoDate === todayISO();
                        return (
                          <div
                            key={di}
                            title={`${rec.date}${cellText(rec) ? ` · ${cellText(rec)}` : ''}`}
                            className={`h-16 rounded-control border px-1.5 py-1.5 sm:px-2 flex flex-col justify-between transition-colors ${cellColor(rec.status)} ${isToday ? 'ring-2 ring-accent ring-offset-1' : ''}`}
                          >
                            <div className="flex items-center justify-between">
                              <span className={`text-xs font-bold tabular-nums ${isToday ? 'text-accent' : 'text-ink'}`}>{dayNum}</span>
                              {rec.status !== 'absent' && rec.status !== 'weekend' && (
                                <span className={`w-2 h-2 rounded-full ${dotColor(rec.status)}`} aria-hidden="true" />
                              )}
                            </div>
                            <span className={`hidden sm:block text-xs leading-none truncate tabular-nums ${rec.status === 'absent' ? 'text-danger' : 'text-muted'}`}>
                              {cellText(rec)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-4 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-ok" />Present</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-warn" />Half day</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-paper border border-accent" />On leave</span>
                  <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full border border-danger" />Absent</span>
                </div>
              </div>
            </Card>
          );
        }

        // ── List view (work-week / week / bi-weekly) ───────────────────────────
        const compact = viewMode === 'bi-weekly';
        return (
          <Card padding="p-0" className="overflow-hidden">
            {toolbar}
            {/* Rows */}
            <div className="flex flex-col divide-y divide-rule border-t border-rule mt-0">
              {weekLoading ? (
                Array.from({ length: viewMode === 'work-week' ? 5 : 7 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-6 px-5 sm:px-6 py-4 animate-pulse">
                    <div className="w-28 h-4 rounded-full bg-pill" />
                    <div className="flex-1 h-4 rounded-full bg-pill" />
                  </div>
                ))
              ) : weekLog.length === 0 ? (
                <p className="px-5 py-10 text-sm text-muted text-center">No days in this period.</p>
              ) : weekLog.map((rec) => {
                const isToday = rec.isoDate === todayISO();
                const state = statusBadge(rec.status);
                const isWeekendRow = rec.status === 'weekend';
                return (
                  <div key={rec.isoDate} className={`flex items-center gap-3 sm:gap-6 px-5 sm:px-6 ${compact ? 'py-3' : 'py-3.5'} ${isToday ? 'bg-tint/40' : 'hover:bg-page'} ${isWeekendRow ? 'opacity-60' : ''} transition-colors`}>
                    <div className="w-24 sm:w-32 shrink-0 flex items-center gap-2">
                      {isToday && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-hidden="true" />}
                      <p className={`text-sm font-semibold tabular-nums ${isToday ? 'text-accent' : 'text-ink'}`}>{rec.date}</p>
                    </div>
                    {isWeekendRow ? (
                      <p className="flex-1 text-[13px] text-faint">Weekend</p>
                    ) : (
                      <>
                        {/* Labelled columns from 640px; a single "in → out · dur" line below that and in the bi-weekly view. */}
                        <div className={`flex-1 min-w-0 ${compact ? 'flex' : 'flex sm:hidden'} items-center gap-2 text-sm tabular-nums`}>
                          <span className="font-semibold text-ink">{rec.clockIn ?? '—'}</span>
                          <Icon name="arrowRight" size={13} className="text-faint shrink-0" />
                          <span className="font-semibold text-ink">{rec.clockOut ?? '—'}</span>
                          {rec.duration && <span className="text-muted ml-1 truncate">· {rec.duration}</span>}
                        </div>
                        {!compact && (
                          <div className="hidden sm:grid flex-1 grid-cols-3 gap-4 tabular-nums">
                            <div><p className="text-xs text-muted">Clock in</p><p className="text-sm font-semibold text-ink mt-0.5">{rec.clockIn ?? '—'}</p></div>
                            <div><p className="text-xs text-muted">Clock out</p><p className="text-sm font-semibold text-ink mt-0.5">{rec.clockOut ?? '—'}</p></div>
                            <div><p className="text-xs text-muted">Duration</p><p className="text-sm font-semibold text-accent mt-0.5">{rec.duration ?? '—'}</p></div>
                          </div>
                        )}
                      </>
                    )}
                    <Badge tone={state.tone}>{state.txt}</Badge>
                  </div>
                );
              })}
            </div>
          </Card>
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
