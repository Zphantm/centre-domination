const INITIAL_BOARD = ['R','G','R','G', 'R','G','R','G', null];
let board = [...INITIAL_BOARD];

let currentPlayer = 'R';
let selected = null;
let winner = null;
let isAiThinking = false;
let isAnimating = false;
let gameMode = '1P'; // '1P', '2P', or 'Online'
let socket = null;
let roomCode = null;
let playerRole = null; // 'R' or 'G'
let isGameActive = false; // True when 2 players are in an Online room

// adjacency map
const adjacency = {
  0: [1,7,8],
  1: [0,2,8],
  2: [1,3,8],
  3: [2,4,8],
  4: [3,5,8],
  5: [4,6,8],
  6: [5,7,8],
  7: [6,0,8],
  8: [0,1,2,3,4,5,6,7]
};

// Initialize socket
if (typeof io !== 'undefined') {
  socket = io();

  socket.on('playerRole', (role) => {
    playerRole = role;
    updateStatusUI();
  });

  socket.on('roomCreated', ({ roomCode: code }) => {
    console.log("Room created event received for code:", code);
    roomCode = code;
    gameMode = 'Online';
    isGameActive = false; // Waiting for opponent
    showGame();
    updateStatusUI();
  });

  socket.on('gameStart', ({ roomCode: code }) => {
    console.log("Game start event received for code:", code);
    roomCode = code;
    gameMode = 'Online';
    isGameActive = true; // Opponent joined!
    showGame();
    updateStatusUI();
    
    const qrOverlay = document.getElementById('qr-overlay');
    if (qrOverlay) qrOverlay.classList.add('hidden');
  });

  socket.on('opponentMove', ({ from, to }) => {
    executeMove(from, to, true);
  });

  socket.on('gameReset', () => {
    resetGame(true);
  });

  socket.on('opponentDisconnected', () => {
    alert('Opponent disconnected. Returning to menu.');
    window.location.href = window.location.pathname;
  });

  socket.on('error', (msg) => {
    alert(msg);
    showMenu();
  });
}

// Auto-join from URL
window.addEventListener('load', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('room');
  if (code) {
    roomCode = code.toUpperCase();
    gameMode = 'Online';
    socket.emit('joinRoom', roomCode);
  }
});

function render() {
  document.querySelectorAll('.cell').forEach(cell => {
    const index = Number(cell.dataset.index);
    cell.classList.remove('red', 'green', 'selected');

    if (board[index] === 'R') cell.classList.add('red');
    if (board[index] === 'G') cell.classList.add('green');
    if (selected === index) cell.classList.add('selected');
  });

  const redCount = board.filter(cell => cell === 'R').length;
  const greenCount = board.filter(cell => cell === 'G').length;
  document.getElementById('red-count').textContent = redCount;
  document.getElementById('green-count').textContent = greenCount;

  const turnDisplay = document.getElementById('turn-display');
  if (!turnDisplay) return; // Wait until DOM is ready

  if (winner) {
    turnDisplay.textContent = `${winner === 'R' ? 'Red' : 'Green'} Wins!`;
    turnDisplay.style.color = (winner === 'R') ? 'red' : 'limegreen';
    turnDisplay.style.fontSize = '2em';
    turnDisplay.style.fontWeight = 'bold';
  } else if (isAiThinking) {
    turnDisplay.textContent = "AI is thinking...";
    turnDisplay.style.color = 'limegreen';
    turnDisplay.style.fontSize = '';
    turnDisplay.style.fontWeight = '';
  } else {
    turnDisplay.textContent = `Current Player: ${currentPlayer === 'R' ? 'Red' : 'Green'}`;
    turnDisplay.style.color = (currentPlayer === 'R') ? 'red' : 'limegreen';
    turnDisplay.style.fontSize = '';
    turnDisplay.style.fontWeight = '';
  }
}

function handleClick(e) {
  if (winner || isAiThinking || isAnimating) return; // Game over, AI's turn, or animation playing

  // In 1P mode, the user is always Red. They cannot select or move Green pieces.
  if (gameMode === '1P' && currentPlayer === 'G') {
    console.warn("User attempted to move during AI turn.");
    return;
  }

  // In Online mode, user can only move their assigned color
  if (gameMode === 'Online' && currentPlayer !== playerRole) {
    console.warn("It is not your turn!");
    return;
  }

  const index = Number(e.target.dataset.index);

  if (selected === null) {
    if (board[index] === currentPlayer) {
      selected = index;
    }
  } else {
    const from = selected;
    const to = index;
    if (isValidMove(from, to)) {
      executeMove(from, to);
      if (gameMode === 'Online') {
        socket.emit('makeMove', { roomCode, from, to });
      }
    } else {
      selected = null;
    }
  }

  render();
}

async function executeMove(from, to, isOpponent = false) {
  if (isOpponent) {
    // Show opponent's selection before move
    selected = from;
    render();
    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`--- EXECUTE MOVE: ${currentPlayer} moving from ${from} to ${to} ---`);
  
  isAnimating = true;
  const isCapture = (from < 8 && to < 8 && (from + 4) % 8 === to);
  
  // 1. Move the capturing piece first
  move(from, to);
  selected = null;
  render();

  if (isCapture) {
    // Screen shake on capture
    document.getElementById('game-container').classList.add('shake');
    setTimeout(() => document.getElementById('game-container').classList.remove('shake'), 400);

    // 2. Short delay after the piece reaches its destination
    await new Promise(r => setTimeout(r, 400));
    
    // 3. Trigger capture animation on the center piece
    const centerCell = document.querySelector('.cell[data-index="8"]');
    centerCell.classList.add('capturing');
    
    // 4. Wait for the animation to complete
    await new Promise(r => setTimeout(r, 600));
    centerCell.classList.remove('capturing');
    
    // 5. Finally remove the piece from the board data
    board[8] = null;
    render();
  }

  // switch player and check for win
  currentPlayer = (currentPlayer === 'R') ? 'G' : 'R';
  checkWinner();
  isAnimating = false;
  render();

  console.log(`Next Turn: ${currentPlayer}, Mode: ${gameMode}, Winner: ${winner || 'None'}`);

  // If game not over and it's AI's turn (Green), trigger AI
  if (!winner && currentPlayer === 'G' && gameMode === '1P') {
    console.log("Triggering AI Move...");
    triggerAiMove();
  }
}

function triggerAiMove() {
  if (winner) {
    console.log("AI trigger skipped: winner already declared.");
    return;
  }
  
  isAiThinking = true;
  console.log("AI is thinking... setting isAiThinking to true");
  render();

  // Use a slightly longer delay to ensure the UI has time to render the "Thinking" state
  setTimeout(async () => {
    console.log("AI timeout reached, calculating move...");
    try {
      const aiMove = getMinimaxMove('G');
      if (aiMove) {
        console.log("AI move found:", aiMove);
        
        // Show AI selection first
        selected = aiMove.from;
        render();
        await new Promise(r => setTimeout(r, 500)); // Delay to show selection
        
        // Execute the move
        await executeMove(aiMove.from, aiMove.to);
        isAiThinking = false;
        render();
      } else {
        console.warn("AI could not find a valid move!");
        isAiThinking = false;
        render();
      }
    } catch (error) {
      console.error("CRITICAL AI Error:", error);
      isAiThinking = false;
      render();
    }
  }, 800);
}

// MINIMAX AI LOGIC
function getMinimaxMove(player) {
  const moves = getAllPossibleMoves(board, player);
  if (moves.length === 0) {
    console.log("AI has no moves available.");
    return null;
  }

  console.log(`AI evaluating ${moves.length} possible moves...`);
  
  let bestScore = -Infinity;
  let move = moves[0];
  
  // Slightly lower depth for guaranteed performance
  const SEARCH_DEPTH = 3; 

  for (const m of moves) {
    const tempBoard = [...board];
    simulateMove(tempBoard, m.from, m.to);
    let score = minimax(tempBoard, 0, false, -Infinity, Infinity, SEARCH_DEPTH);
    if (score > bestScore) {
      bestScore = score;
      move = m;
    }
  }
  return move;
}

function minimax(currentBoard, depth, isMaximizing, alpha, beta, maxDepth) {
  const result = checkBoardWinner(currentBoard);
  if (result === 'G') return 100 - depth;
  if (result === 'R') return depth - 100;
  if (depth >= maxDepth) return evaluateBoard(currentBoard);

  if (isMaximizing) {
    let maxEval = -Infinity;
    const moves = getAllPossibleMoves(currentBoard, 'G');
    if (moves.length === 0) return evaluateBoard(currentBoard);
    for (const m of moves) {
      const nextBoard = [...currentBoard];
      simulateMove(nextBoard, m.from, m.to);
      let eval = minimax(nextBoard, depth + 1, false, alpha, beta, maxDepth);
      maxEval = Math.max(maxEval, eval);
      alpha = Math.max(alpha, eval);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    const moves = getAllPossibleMoves(currentBoard, 'R');
    if (moves.length === 0) return evaluateBoard(currentBoard);
    for (const m of moves) {
      const nextBoard = [...currentBoard];
      simulateMove(nextBoard, m.from, m.to);
      let eval = minimax(nextBoard, depth + 1, true, alpha, beta, maxDepth);
      minEval = Math.min(minEval, eval);
      beta = Math.min(beta, eval);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function evaluateBoard(b) {
  let score = 0;
  // Center is highly valued
  if (b[8] === 'G') score += 10;
  if (b[8] === 'R') score -= 10;
  
  // Material count
  const gPieces = b.filter(p => p === 'G').length;
  const rPieces = b.filter(p => p === 'R').length;
  score += (gPieces - rPieces) * 20;

  // Mobility
  const gMoves = getAllPossibleMoves(b, 'G').length;
  const rMoves = getAllPossibleMoves(b, 'R').length;
  score += (gMoves - rMoves);

  return score;
}

function getAllPossibleMoves(b, player) {
  const moves = [];
  b.forEach((cell, from) => {
    if (cell === player) {
      for (let to = 0; to < 9; to++) {
        if (isValidMoveOnBoard(b, from, to, player)) {
          moves.push({ from, to });
        }
      }
    }
  });
  return moves;
}

function isValidMoveOnBoard(b, from, to, player) {
  // Adjacent move
  if (b[from] === player && b[to] === null && adjacency[from].includes(to)) return true;
  // Jump move
  if (b[from] === player && b[to] === null && from < 8 && to < 8 && (from + 4) % 8 === to && b[8] !== null && b[8] !== player) return true;
  return false;
}

function simulateMove(b, from, to) {
  if (from < 8 && to < 8 && (from + 4) % 8 === to) b[8] = null;
  b[to] = b[from];
  b[from] = null;
}

function checkBoardWinner(b) {
  const rPieces = b.filter(p => p === 'R').length;
  const gPieces = b.filter(p => p === 'G').length;
  if (rPieces === 0) return 'G';
  if (gPieces === 0) return 'R';

  // Check if player has moves (this is simplified for performance)
  const rMoves = getAllPossibleMoves(b, 'R').length;
  const gMoves = getAllPossibleMoves(b, 'G').length;
  if (rMoves === 0) return 'G';
  if (gMoves === 0) return 'R';
  return null;
}

function checkWinner() {
  const opponent = currentPlayer;
  const player = currentPlayer === 'R' ? 'G' : 'R';

  console.log(`Checking winner. Opponent: ${opponent}, Player: ${player}`);
  console.log("Current board state:", JSON.stringify(board));

  // Check if opponent has no pieces left
  const opponentPieces = board.filter(cell => cell === opponent);
  if (opponentPieces.length === 0) {
    console.log(`WINNER: ${player} (Opponent has no pieces)`);
    winner = player;
    return;
  }

  // Check if opponent has no legal moves
  let hasMove = false;
  board.forEach((cell, fromIndex) => {
    if (cell === opponent) {
      // Check all possible destination slots (0-8)
      for (let toIndex = 0; toIndex < 9; toIndex++) {
        if (isValidMoveForPlayer(fromIndex, toIndex, opponent)) {
          console.log(`Opponent ${opponent} has move: ${fromIndex} -> ${toIndex}`);
          hasMove = true;
          break;
        }
      }
    }
  });

  if (!hasMove) {
    console.log(`WINNER: ${player} (Opponent is trapped)`);
    winner = player;
  } else {
    console.log(`No winner yet. Opponent ${opponent} still has moves.`);
  }
}

// helper to check moves for any player
function isValidMoveForPlayer(from, to, player) {
  // standard move to adjacent empty spot
  const isAdjacentMove = board[from] === player &&
    board[to] === null &&
    adjacency[from].includes(to);

  // jumping over center (8) to opposite side
  const isJumpMove = board[from] === player &&
    board[to] === null &&
    from < 8 && to < 8 &&
    (from + 4) % 8 === to &&
    board[8] !== null && board[8] !== player;

  return isAdjacentMove || isJumpMove;
}

function isValidMove(from, to) {
  return isValidMoveForPlayer(from, to, currentPlayer);
}

function move(from, to) {
  if (from === null || to === null || from === undefined || to === undefined) {
    console.error("Invalid move indices:", from, to);
    return;
  }
  board[to] = board[from];
  board[from] = null;
}

function resetGame(isOpponent = false) {
  board = [...INITIAL_BOARD];
  // In 1P mode, Green (AI) starts first. In 2/Online mode, Red starts first.
  currentPlayer = (gameMode === '1P') ? 'G' : 'R';
  selected = null;
  winner = null;
  isAiThinking = false;
  isAnimating = false;
  render();

  if (gameMode === 'Online') {
    if (!isOpponent) {
      socket.emit('resetGame', roomCode);
    }
    // Only show waiting if we're alone in the room (shouldn't happen on reset, but safe)
    if (playerRole === 'R' && !isOpponent && winner === null) {
      // document.getElementById('waiting-msg').classList.add('hidden'); 
    }
  }

  // If AI starts, trigger its move immediately
  if (gameMode === '1P' && currentPlayer === 'G') {
    triggerAiMove();
  }
}

document.querySelectorAll('.cell').forEach(cell => {
  cell.addEventListener('click', handleClick);
});

document.getElementById('reset-btn').addEventListener('click', resetGame);

document.getElementById('home-btn').addEventListener('click', () => {
  showMenu();
  resetGame();
});

document.getElementById('btn-1p-splash').addEventListener('click', () => {
  gameMode = '1P';
  showGame();
});

document.getElementById('btn-2p-splash').addEventListener('click', () => {
  gameMode = '2P';
  showGame();
});

document.getElementById('btn-online-splash').addEventListener('click', () => {
  const modal = document.getElementById('room-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
});

document.getElementById('btn-cancel-modal').addEventListener('click', () => {
  const modal = document.getElementById('room-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const codeInput = document.getElementById('room-code-input');
  const code = codeInput.value.trim().toUpperCase();
  if (code) {
    console.log("Attempting to join/create room:", code);
    roomCode = code;
    gameMode = 'Online';
    
    // Hide modal and show the game board immediately (optimistic)
    document.getElementById('room-modal').classList.add('hidden');
    showGame();
    
    // Show waiting state while we connect
    const waitingMsg = document.getElementById('waiting-msg');
    const roomDisplay = document.getElementById('room-display');
    const statusBar = document.getElementById('game-status-bar');
    
    if (waitingMsg) waitingMsg.classList.remove('hidden');
    if (roomDisplay) roomDisplay.textContent = `Room: ${roomCode}`;
    if (statusBar) statusBar.classList.remove('hidden');

    if (socket && socket.connected) {
      socket.emit('joinRoom', roomCode);
    } else {
      console.warn("Socket not connected, trying to connect...");
      socket.once('connect', () => {
        socket.emit('joinRoom', roomCode);
      });
    }
  } else {
    alert('Please enter a room code');
  }
});

function showQRCode() {
  const container = document.getElementById('qrcode-container');
  if (!container) return;
  container.innerHTML = '';
  
  // Create URL with room code
  const joinUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;
  
  new QRCode(container, {
    text: joinUrl,
    width: 200,
    height: 200,
    colorDark : "#000000",
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.H
  });
  
  const roomCodeSpan = document.getElementById('qr-room-code');
  if (roomCodeSpan) roomCodeSpan.textContent = roomCode;
  
  const qrOverlay = document.getElementById('qr-overlay');
  if (qrOverlay) qrOverlay.classList.remove('hidden');
}

document.getElementById('show-qr-btn').addEventListener('click', showQRCode);
document.getElementById('close-qr-btn').addEventListener('click', () => {
  const qrOverlay = document.getElementById('qr-overlay');
  if (qrOverlay) qrOverlay.classList.add('hidden');
});

function showGame() {
  console.log("CRITICAL: showGame called. Hiding splash and showing board.");
  const splash = document.getElementById('splash-screen');
  const game = document.getElementById('game-container');
  const modal = document.getElementById('room-modal');

  if (splash) {
    splash.classList.add('hidden');
    splash.style.display = 'none';
  }
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
  if (game) {
    game.classList.remove('hidden');
    game.style.display = 'flex';
  }
  
  resetGame();
}

function showMenu() {
  console.log("CRITICAL: showMenu called. Hiding board and showing splash.");
  const splash = document.getElementById('splash-screen');
  const game = document.getElementById('game-container');
  const modal = document.getElementById('room-modal');

  if (game) {
    game.classList.add('hidden');
    game.style.display = 'none';
  }
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
  if (splash) {
    splash.classList.remove('hidden');
    splash.style.display = 'block';
  }
  
  isGameActive = false;
  roomCode = null;
  playerRole = null;
  updateStatusUI();
}

function updateStatusUI() {
  const statusBar = document.getElementById('game-status-bar');
  const waitingMsg = document.getElementById('waiting-msg');
  const roomDisplay = document.getElementById('room-display');
  const playerIndicator = document.getElementById('player-indicator');

  if (gameMode === 'Online' && roomCode) {
    if (statusBar) statusBar.classList.remove('hidden');
    if (roomDisplay) roomDisplay.textContent = `Room: ${roomCode}`;
    if (playerIndicator) playerIndicator.textContent = `You are ${playerRole === 'R' ? 'Red' : 'Green'}`;
    
    if (!isGameActive) {
      if (waitingMsg) waitingMsg.classList.remove('hidden');
    } else {
      if (waitingMsg) waitingMsg.classList.add('hidden');
    }
  } else {
    if (statusBar) statusBar.classList.add('hidden');
    if (waitingMsg) waitingMsg.classList.add('hidden');
  }
}

render();