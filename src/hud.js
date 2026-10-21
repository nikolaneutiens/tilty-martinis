import * as THREE from 'three/webgpu';

export const HUD_WIDTH = 1024;
export const HUD_HEIGHT = 768;
const MARGIN_X = 110;
const MARGIN_Y = 80;
const INK = '#ffffff';
const OUTLINE = 'rgba(0, 0, 0, 0.9)';
const TITLE_FONT = '"Mr Dafoe", cursive';
const HAND_FONT = '"Caveat", cursive';
const ITEM_FONT_SIZE = 76;

export const MENU_ITEMS = [
  { id: 'play', label: 'play', x: 770, y: 560 },
  { id: 'guide', label: 'guide', x: 770, y: 650 },
];

export const OVER_ITEMS = [
  { id: 'retry', label: 'another round', x: 330, y: 560 },
  { id: 'menu', label: 'main menu', x: 330, y: 650 },
];

const GUIDE_SECTIONS = [
  { picture: 'balance', caption: ['balance with', 'your body'] },
  { picture: 'lives', caption: ['3 martinis down', "and you're out"] },
  { picture: 'raise', caption: ['raise your hand', 'for another round'] },
];

export const createHud = () => {
  const canvas = document.createElement('canvas');
  canvas.width = HUD_WIDTH;
  canvas.height = HUD_HEIGHT;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const write = (text, x, y, font, align = 'left') => {
    ctx.font = font;
    ctx.textAlign = align;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = OUTLINE;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = INK;
    ctx.fillText(text, x, y);
    return ctx.measureText(text).width;
  };

  const ink = (width = 7) => {
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
  };

  const line = (points) => {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.stroke();
  };

  const drawMartini = (x, y, size, full = true, angle = 0) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(size / 100, size / 100);
    ink();
    ctx.beginPath();
    ctx.moveTo(-40, -45);
    ctx.lineTo(40, -45);
    ctx.lineTo(0, 5);
    ctx.closePath();
    if (full) ctx.fill();
    ctx.stroke();
    line([[0, 5], [0, 45]]);
    line([[-22, 45], [22, 45]]);
    if (!full) line([[-38, -50], [38, 50]]);
    ctx.restore();
  };

  const drawFigure = (x, y, lean, armsUp) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);
    ink(6);
    ctx.beginPath();
    ctx.arc(0, -78, 14, 0, Math.PI * 2);
    ctx.stroke();
    line([[0, -64], [0, -10]]);
    line([[0, -10], [-16, 30]]);
    line([[0, -10], [16, 30]]);
    armsUp(line);
    ctx.restore();
  };

  const drawItems = (items, selection, progress = 0) => {
    items.forEach((item, i) => {
      const selected = i === selection;
      ctx.globalAlpha = selected ? 1 : 0.65;
      const width = write(item.label, item.x, item.y, `700 ${ITEM_FONT_SIZE}px ${HAND_FONT}`);
      ctx.globalAlpha = 1;
      if (!selected) return;
      drawMartini(item.x - 45, item.y - 26, 40);
      ink(5);
      ctx.beginPath();
      ctx.moveTo(item.x, item.y + 12);
      ctx.quadraticCurveTo(item.x + width / 2, item.y + 20, item.x + width + 6, item.y + 8);
      ctx.globalAlpha = 0.35;
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (progress > 0) {
        ctx.beginPath();
        ctx.moveTo(item.x, item.y + 12);
        ctx.lineTo(item.x + (width + 6) * progress, item.y + 12 + 4 * progress);
        ctx.stroke();
      }
    });
  };

  const drawGame = ({ score, lives, maxLives }) => {
    ctx.textBaseline = 'top';
    const numberWidth = write(String(score), MARGIN_X, MARGIN_Y - 10, `700 96px ${HAND_FONT}`);
    write(score === 1 ? 'martini' : 'martinis', MARGIN_X + numberWidth + 14, MARGIN_Y + 34, `700 48px ${HAND_FONT}`);
    for (let i = 0; i < maxLives; i++) {
      const x = HUD_WIDTH - MARGIN_X - 30 - (maxLives - 1 - i) * 66;
      drawMartini(x, MARGIN_Y + 46, 52, i < lives);
    }
  };

  const drawMenu = ({ selection, best }) => {
    ctx.textBaseline = 'alphabetic';
    write('Tilty', 540, 260, `180px ${TITLE_FONT}`);
    write('Martinis', 560, 380, `128px ${TITLE_FONT}`);
    drawItems(MENU_ITEMS, selection);
    if (best > 0) {
      drawMartini(MARGIN_X + 22, HUD_HEIGHT - MARGIN_Y - 30, 40);
      write(`best: ${best}`, MARGIN_X + 60, HUD_HEIGHT - MARGIN_Y - 10, `700 52px ${HAND_FONT}`);
    }
  };

  const drawOver = ({ score, best, selection, raiseProgress }) => {
    ctx.textBaseline = 'alphabetic';
    write("party's over", HUD_WIDTH / 2, 280, `700 130px ${HAND_FONT}`, 'center');
    write(`${score} ${score === 1 ? 'martini' : 'martinis'} on the tray · best ${best}`, HUD_WIDTH / 2, 370, `700 52px ${HAND_FONT}`, 'center');
    drawItems(OVER_ITEMS, selection, raiseProgress);
    write('or raise your hand', 330, 720, `700 40px ${HAND_FONT}`);
  };

  const drawCalibrate = ({ hint, shoulderAngle, steady, calibrateProgress }) => {
    ctx.textBaseline = 'alphabetic';
    write('stand up straight', HUD_WIDTH / 2, 250, `700 110px ${HAND_FONT}`, 'center');
    write(hint, HUD_WIDTH / 2, 320, `700 52px ${HAND_FONT}`, 'center');

    const cx = HUD_WIDTH / 2;
    const cy = 430;
    ink(3);
    ctx.setLineDash([12, 10]);
    ctx.globalAlpha = 0.5;
    line([[cx - 130, cy], [cx + 130, cy]]);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(shoulderAngle);
    ink(steady ? 9 : 6);
    line([[-110, 0], [110, 0]]);
    [-110, 110].forEach((x) => {
      ctx.beginPath();
      ctx.arc(x, 0, 12, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    const barWidth = 360;
    ink(4);
    ctx.globalAlpha = 0.4;
    line([[cx - barWidth / 2, 520], [cx + barWidth / 2, 520]]);
    ctx.globalAlpha = 1;
    ink(10);
    if (calibrateProgress > 0) line([[cx - barWidth / 2, 520], [cx - barWidth / 2 + barWidth * calibrateProgress, 520]]);

    write('playing with the keys? press space to skip', cx, 640, `700 40px ${HAND_FONT}`, 'center');
  };

  const pictures = {
    balance: (x, y) => {
      const lean = -0.18;
      drawFigure(x, y + 70, lean, (draw) => {
        draw([[0, -52], [-34, -96]]);
        draw([[0, -52], [34, -96]]);
      });
      ctx.save();
      ctx.translate(x, y + 70);
      ctx.rotate(lean);
      ink(7);
      line([[-60, -100], [60, -100]]);
      drawMartini(-30, -126, 34);
      drawMartini(14, -126, 34);
      drawMartini(-8, -165, 34);
      ctx.restore();
      ink(4);
      ctx.beginPath();
      ctx.arc(x, y + 80, 95, Math.PI * 1.1, Math.PI * 1.35);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + 80, 95, Math.PI * 1.65, Math.PI * 1.9);
      ctx.stroke();
    },
    lives: (x, y) => {
      [-62, 0, 62].forEach((dx) => drawMartini(x + dx, y + 10, 52, false));
      ink(4);
      line([[x - 70, y + 80], [x + 70, y + 80]]);
      drawMartini(x - 30, y + 66, 26, true, 1.4);
    },
    raise: (x, y) => {
      drawFigure(x - 10, y + 70, 0, (draw) => {
        draw([[0, -52], [-28, -18]]);
        draw([[0, -52], [30, -110]]);
      });
      drawMartini(x + 52, y - 70, 40);
    },
  };

  const drawGuide = () => {
    ctx.fillStyle = 'rgba(8, 6, 4, 0.92)';
    ctx.beginPath();
    ctx.roundRect(MARGIN_X - 20, MARGIN_Y - 10, HUD_WIDTH - 2 * MARGIN_X + 40, HUD_HEIGHT - 2 * MARGIN_Y + 20, 24);
    ctx.fill();

    ctx.textBaseline = 'alphabetic';
    write('How to play', HUD_WIDTH / 2, MARGIN_Y + 100, `110px ${TITLE_FONT}`, 'center');

    const columnWidth = (HUD_WIDTH - 2 * MARGIN_X) / 3;
    GUIDE_SECTIONS.forEach((section, i) => {
      const x = MARGIN_X + columnWidth * (i + 0.5);
      const panelTop = MARGIN_Y + 140;
      ink(3);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.roundRect(x - columnWidth / 2 + 14, panelTop, columnWidth - 28, 230, 18);
      ctx.stroke();
      ctx.globalAlpha = 1;
      pictures[section.picture](x, panelTop + 120);
      section.caption.forEach((text, row) => {
        write(text, x, panelTop + 290 + row * 44, `700 36px ${HAND_FONT}`, 'center');
      });
    });

    write('press space to go back', HUD_WIDTH / 2, HUD_HEIGHT - MARGIN_Y - 6, `700 38px ${HAND_FONT}`, 'center');
  };

  const painters = { game: drawGame, menu: drawMenu, over: drawOver, guide: drawGuide, calibrate: drawCalibrate };

  const draw = (options) => {
    ctx.save();
    ctx.clearRect(0, 0, HUD_WIDTH, HUD_HEIGHT);
    painters[options.mode]?.(options);
    ctx.restore();
    texture.needsUpdate = true;
  };

  return { texture, draw };
};

export const itemAt = (items, x, y) =>
  items.findIndex((item) => x > item.x - 70 && x < item.x + 420 && y > item.y - ITEM_FONT_SIZE && y < item.y + 20);
