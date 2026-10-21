const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = {};
const GLOBAL_ROOM_ID = 'MAIN_ROOM';

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Host สร้างห้อง (รับค่า hostAnswersLast มาด้วย)
  socket.on('createRoom', ({ hostName, questionsJson, hostAnswersLast }) => {
    try {
      const questions = JSON.parse(questionsJson);

      rooms[GLOBAL_ROOM_ID] = {
        hostId: socket.id,
        players: {},
        questions: questions,
        currentQuestionIndex: -1,
        state: 'lobby',
        hostAnswersLast: !!hostAnswersLast, // บันทึก Option ของห้องนี้
      };

      rooms[GLOBAL_ROOM_ID].players[socket.id] = {
        name: hostName,
        score: 0,
        currentAnswer: null,
        answersHistory: [],
      };

      socket.join(GLOBAL_ROOM_ID);
      socket.emit('roomCreated', {
        roomCode: GLOBAL_ROOM_ID,
        isHost: true,
        hostAnswersLast: !!hostAnswersLast,
      });
      io.to(GLOBAL_ROOM_ID).emit(
        'updatePlayers',
        Object.values(rooms[GLOBAL_ROOM_ID].players)
      );
    } catch (err) {
      socket.emit('error', 'Invalid JSON format');
    }
  });

  // Join เข้าร่วมห้อง
  socket.on('joinRoom', ({ playerName }) => {
    if (rooms[GLOBAL_ROOM_ID] && rooms[GLOBAL_ROOM_ID].state === 'lobby') {
      rooms[GLOBAL_ROOM_ID].players[socket.id] = {
        name: playerName,
        score: 0,
        currentAnswer: null,
        answersHistory: [],
      };
      socket.join(GLOBAL_ROOM_ID);
      socket.emit('joinedRoom', {
        roomCode: GLOBAL_ROOM_ID,
        isHost: false,
        hostAnswersLast: rooms[GLOBAL_ROOM_ID].hostAnswersLast,
      });
      io.to(GLOBAL_ROOM_ID).emit(
        'updatePlayers',
        Object.values(rooms[GLOBAL_ROOM_ID].players)
      );
    } else {
      socket.emit('error', 'No active lobby found or game already started.');
    }
  });

  // ไปข้อถัดไป
  socket.on('nextQuestion', (roomCode) => {
    const room = rooms[roomCode];
    if (room && room.hostId === socket.id) {
      room.currentQuestionIndex++;

      for (const playerId in room.players) {
        room.players[playerId].currentAnswer = null;
      }

      if (room.currentQuestionIndex >= room.questions.length) {
        room.state = 'ended';
        const playersData = Object.keys(room.players).map((id) => {
          return { id: id, ...room.players[id] };
        });
        io.to(roomCode).emit('gameEnded', playersData);
      } else {
        room.state = 'playing';
        const question = room.questions[room.currentQuestionIndex];
        const questionData = {
          question: question.question,
          choices: question.choices,
          index: room.currentQuestionIndex,
          total: room.questions.length,
        };

        io.to(roomCode).emit('newQuestion', questionData);

        // 🔴 ส่งสถานะเริ่มต้น (ทุกคนยังไม่ตอบ) ไปให้ UI ทำการเช็คล็อกปุ่มโฮสต์ทันที
        const allPlayersKeys = Object.keys(room.players);
        io.to(roomCode).emit(
          'answerStatus',
          allPlayersKeys.map((id) => ({
            id: id,
            name: room.players[id].name,
            answered: false,
            isHost: id === room.hostId, // ส่งไปบอก UI ว่าใครคือ Host
          }))
        );
      }
    }
  });

  // ส่งคำตอบ
  socket.on('submitAnswer', ({ roomCode, answerIndex }) => {
    const room = rooms[roomCode];
    if (room && room.state === 'playing') {
      const player = room.players[socket.id];
      if (player.currentAnswer !== null) return;

      // 🔴 Backend Validation: ถ้าเปิดโหมด Host Last และโฮสต์พยายามกดตอบ
      if (room.hostAnswersLast && room.hostId === socket.id) {
        const otherPlayersKeys = Object.keys(room.players).filter(
          (id) => id !== socket.id
        );
        const othersAllAnswered = otherPlayersKeys.every(
          (id) => room.players[id].currentAnswer !== null
        );

        if (otherPlayersKeys.length > 0 && !othersAllAnswered) {
          socket.emit(
            'error',
            'You must wait for all players to answer first.'
          );
          return; // สกัดกั้นการส่งคำตอบ
        }
      }

      player.currentAnswer = answerIndex;

      const allPlayersKeys = Object.keys(room.players);
      const allAnswered = allPlayersKeys.every(
        (id) => room.players[id].currentAnswer !== null
      );

      io.to(roomCode).emit(
        'answerStatus',
        allPlayersKeys.map((id) => ({
          id: id,
          name: room.players[id].name,
          answered: room.players[id].currentAnswer !== null,
          isHost: id === room.hostId,
        }))
      );

      if (allAnswered) {
        room.state = 'revealed';
        const currentQ = room.questions[room.currentQuestionIndex];

        for (const playerId in room.players) {
          const p = room.players[playerId];
          const isCorrect = p.currentAnswer === currentQ.answer;
          if (isCorrect) p.score++;

          p.answersHistory.push({
            questionNumber: room.currentQuestionIndex + 1,
            questionText: currentQ.question,
            selectedAnswerText:
              p.currentAnswer !== null
                ? currentQ.choices[p.currentAnswer]
                : 'No Answer',
            correctAnswerText: currentQ.choices[currentQ.answer],
            isCorrect: isCorrect,
            selectedIndex: p.currentAnswer,
            correctIndex: currentQ.answer,
            explanations: currentQ.explanations || [],
          });
        }

        io.to(roomCode).emit('revealAnswer', {
          correctAnswerIndex: currentQ.answer,
          explanations: currentQ.explanations,
          players: Object.values(room.players),
        });
      }
    }
  });

  socket.on('disconnect', () => {
    if (rooms[GLOBAL_ROOM_ID] && rooms[GLOBAL_ROOM_ID].players[socket.id]) {
      delete rooms[GLOBAL_ROOM_ID].players[socket.id];
      io.to(GLOBAL_ROOM_ID).emit(
        'updatePlayers',
        Object.values(rooms[GLOBAL_ROOM_ID].players)
      );
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
