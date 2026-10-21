import { loadNumber, saveNumber } from './storage.js';

const SENSITIVITY_KEY = 'tilty-martinis-sensitivity';
const SMOOTHING = 0.5;
const DETECT_INTERVAL = 1000 / 30;
const LOST_AFTER = 500;
const MIN_CONFIDENCE = 0.3;
const WEBCAM_WIDTH = 320;
const WEBCAM_HEIGHT = 240;

export const body = {
  status: 'off',
  lean: 0,
  lastSeen: 0,
  neutral: 0,
  angle: 0,
  handRaised: false,
  sensitivity: loadNumber(SENSITIVITY_KEY, 1),
};

export const changeSensitivity = (delta) => {
  body.sensitivity = Math.round(Math.min(Math.max(body.sensitivity + delta, 0.2), 3) * 10) / 10;
  saveNumber(SENSITIVITY_KEY, body.sensitivity);
};

export const isTracking = () => body.status === 'tracking' && performance.now() - body.lastSeen < LOST_AFTER;

export const calibrate = () => {
  if (isTracking()) body.neutral = body.angle;
};

const openHiddenWebcam = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: WEBCAM_WIDTH, height: WEBCAM_HEIGHT, facingMode: 'user' },
    audio: false,
  });
  const video = document.createElement('video');
  video.width = WEBCAM_WIDTH;
  video.height = WEBCAM_HEIGHT;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.style.cssText = 'position:absolute;left:-9999px;top:0';
  document.body.appendChild(video);
  await video.play();
  return video;
};

export const startBodyTracking = async () => {
  if (typeof ml5 === 'undefined') {
    body.status = 'error';
    return;
  }
  try {
    body.status = 'starting';
    const video = await openHiddenWebcam();
    const bodyPose = await ml5.bodyPose('MoveNet', { modelType: 'SINGLEPOSE_LIGHTNING', flipped: true });
    body.status = 'tracking';
    detectLoop(bodyPose, video);
  } catch (err) {
    console.error(err);
    body.status = 'error';
  }
};

const detectLoop = async (bodyPose, video) => {
  while (true) {
    const start = performance.now();
    try {
      onPoses(await bodyPose.detect(video));
    } catch (err) {
      console.error(err);
    }
    const wait = DETECT_INTERVAL - (performance.now() - start);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, wait)));
  }
};

const keypoint = (pose, name) => {
  const point = pose.keypoints.find((k) => k.name === name);
  return point && point.confidence >= MIN_CONFIDENCE ? point : null;
};

const isHandRaised = (pose, shoulderY) => {
  const head = keypoint(pose, 'nose');
  const above = head ? head.y : shoulderY - 60;
  return ['left_wrist', 'right_wrist'].some((name) => {
    const wrist = keypoint(pose, name);
    return wrist !== null && wrist.y < above;
  });
};

const onPoses = (poses) => {
  if (!poses.length) return;
  const pose = poses.reduce((best, p) => (p.confidence > best.confidence ? p : best));
  const left = keypoint(pose, 'left_shoulder');
  const right = keypoint(pose, 'right_shoulder');
  if (!left || !right) return;
  body.handRaised = isHandRaised(pose, Math.min(left.y, right.y));

  const [a, b] = left.x < right.x ? [left, right] : [right, left];
  body.angle = Math.atan2(b.y - a.y, b.x - a.x);
  const target = -(body.angle - body.neutral) * body.sensitivity;
  body.lean += (target - body.lean) * SMOOTHING;
  body.lastSeen = performance.now();
};
