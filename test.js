const { io } = require('socket.io-client');

// 🔴 ตั้งค่า URL เป็น Localhost ก่อน (ถ้าคุณเอา Backend ขึ้น Render/Railway แล้วค่อยเปลี่ยน URL)
const SERVER_URL = 'https://mocktesttogether.onrender.com/';
const TOTAL_BOTS = 50; // จำนวนบอทที่ต้องการทดสอบ
const JOIN_DELAY_MS = 0;

let connectedCount = 0;
let joinedCount = 0;
let answeredCount = 0;

console.log(`🚀 Starting load test with ${TOTAL_BOTS} bots...`);

function createBot(botIndex) {
  // เปลี่ยนจาก const socket = io(); เป็น:
  const socket = io(SERVER_URL , {
    transports: ['websocket', 'polling'],
  });

  const botName = `Bot_Player_${botIndex}`;
  const botId = `bot_id_${botIndex}_${Math.random().toString(36).substring(7)}`; // สร้าง Player ID จำลอง
  let myRoomCode = '';

  // เมื่อเชื่อมต่อสำเร็จ
  socket.on('connect', () => {
    connectedCount++;
    // ให้บอทกด Join Room (ส่ง playerId ไปด้วยตามระบบใหม่)
    socket.emit('joinRoom', { playerName: botName, playerId: botId });
  });

  // เมื่อเข้าห้องสำเร็จ
  socket.on('joinedRoom', (data) => {
    myRoomCode = data.roomCode;
    joinedCount++;
    process.stdout.write(
      `\r✅ Bots Connected: ${connectedCount} | Bots Joined Room: ${joinedCount} / ${TOTAL_BOTS}`
    );

    if (joinedCount === TOTAL_BOTS) {
      console.log(`\n🎉 Success! All ${TOTAL_BOTS} bots joined.`);
      console.log(
        `⏳ Waiting for Host (You) to click "Start Game" on the web...`
      );
    }
  });

  // 🔴 เมื่อโฮสต์กดเปลี่ยนคำถาม (เริ่มเกม หรือ ไปข้อถัดไป)
  socket.on('newQuestion', (data) => {
    if (botIndex === 1) {
      console.log(
        `\n📝 Question ${data.index + 1} received! Bots are thinking...`
      );
      answeredCount = 0; // รีเซ็ตตัวนับการตอบสำหรับข้อใหม่
    }

    // สุ่มคำตอบจากจำนวนช้อยส์ที่มี
    const totalChoices = data.choices.length;
    const randomAnswerIndex = Math.floor(Math.random() * totalChoices);

    // จำลองเวลาคิดของคน (สุ่มตอบในเวลา 1 - 5 วินาที)
    const thinkingTimeMs = Math.floor(Math.random() * 4000) + 1000;

    setTimeout(() => {
      // บอทกดส่งคำตอบ
      socket.emit('submitAnswer', {
        roomCode: myRoomCode,
        answerIndex: randomAnswerIndex,
      });

      answeredCount++;
      process.stdout.write(
        `\r🤖 Bots Answered: ${answeredCount} / ${TOTAL_BOTS}`
      );

      if (answeredCount === TOTAL_BOTS) {
        console.log(`\n✅ All bots answered Question ${data.index + 1}!`);
      }
    }, thinkingTimeMs);
  });

  // เมื่อจบเกม
  socket.on('gameEnded', () => {
    if (botIndex === 1) {
      console.log(`\n🏆 Game Ended! Check the leaderboard on your browser.`);
    }
  });

  socket.on('error', (msg) => {
    console.log(`\n❌ [${botName}] Error: ${msg}`);
  });

  socket.on('connect_error', (err) => {
    console.log(`\n⚠️ [${botName}] Connection Error: ${err.message}`);
  });
}

// ค่อยๆ ปล่อยบอทเข้าไปทีละตัว
let currentBotIndex = 1;
const spawnInterval = setInterval(() => {
  if (currentBotIndex > TOTAL_BOTS) {
    clearInterval(spawnInterval);
  } else {
    createBot(currentBotIndex);
    currentBotIndex++;
  }
}, JOIN_DELAY_MS);
