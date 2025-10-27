/* ======================= Application logic ======================= */
(function () {
  const FLOORS = 10; // floor 0..9
  const ELEVATORS_COUNT = 5;
  const FLOOR_HEIGHT = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--floor-height')) || 70;
  const transitionPerFloor = 0.6;

  // elevator state container
  class Elevator {
    constructor(id, el, initialFloor = 0) {
      this.id = id;
      this.el = el;
      this.currentFloor = initialFloor;
      // console.log('init currentFloor', this.currentFloor);
      this.queue = []; // queue of floor numbers assigned to this elevator
      this.state = 'idle'; // idle | moving | arrived | waiting
      this.busyUntil = 0; // timestamp when free
      this._runningTimer = null;
    }

    distanceTo(floor) {
      return Math.abs(this.currentFloor - floor);
    }

    assign(floor) {
      console.log('assign', floor);
      this.queue.push(floor);
      this.tryProcessQueue();
    }

    tryProcessQueue() {
      if (this.state === 'idle' && this.queue.length > 0) {
        const next = this.queue.shift();
        this.moveTo(next);
      }
    }

    moveTo(targetFloor) {
      const floorsToMove = Math.abs(this.currentFloor - targetFloor);
      const duration = Math.max(0.2, floorsToMove * transitionPerFloor);

      // change color to moving
      this.setColor('--color-moving', true);
      this.state = 'moving';

      const start = performance.now();
      const topPx = (FLOORS - 1 - targetFloor) * FLOOR_HEIGHT;
      this.el.style.transitionDuration = duration + 's';
      // transform: translateY(topPx)
      this.el.style.transform = `translateY(${topPx}px)`;

      // measure time and schedule arrival after duration (plus small buffer)
      clearTimeout(this._runningTimer);
      this._runningTimer = setTimeout(() => {
        const tookMs = performance.now() - start;
        this.currentFloor = targetFloor;
        // arrival
        this.onArrive(tookMs);
      }, duration * 1000 + 30);
    }

    onArrive(tookMs) {
      // beep
      playBeep();
      // set green
      this.setColor('--color-arrived');
      this.state = 'arrived';

      // mark related button
      const btn = document.querySelector(`.call-btn[data-floor=\"${this.currentFloor}\"]`);
      if (btn) {
        btn.classList.remove('waiting');
        btn.classList.add('arrived');
        btn.disabled = true;
        btn.textContent = 'Arrived';
        this.el.innerHTML = `<div class="id" data-floor="${this.id}">E${this.id} ⬤</div>`
      }

      // wait 2 seconds then reset and continue
      setTimeout(() => {
        // reset button
        if (btn) {
          btn.classList.remove('arrived');
          btn.disabled = false;
          btn.textContent = 'Call';
          // this.el.innerHTML = `<div class="id">E${this.id} ⬤</div>`
        }
        // back to idle color
        this.setColor('--color-idle');
        this.state = 'idle';
        this.el.innerHTML = `<div class="id" data-floor="${this.id}">E${this.id} ⬤</div>`
        // process any local queue
        this.tryProcessQueue();
        // try to pick pending global calls
        dispatchPendingCalls();
      }, 2000);
      // record performance metric in DOM for debugging
      this.el.dataset.lastTripMs = Math.round(tookMs);
    }

    setColor(varNameOrColor, immediate = false) {
      // map special tokens
      let color = varNameOrColor;
      if (varNameOrColor.startsWith('--')) {
        color = getComputedStyle(document.documentElement).getPropertyValue(varNameOrColor).trim();
      }
      if (immediate) {
        this.el.style.transition = 'background-color 0.12s linear, transform 0.3s linear';
      } else {
        this.el.style.transition = 'background-color 0.25s linear, transform 0.3s linear';
      }
      this.el.style.backgroundColor = color;
      // console.log(this.el, this.id);
      this.el.innerHTML = `<div class="id" data-floor="${this.id}">E${this.id}↑</div>`
    }
  }

  // create elevator elements (static number) within the shaft
  const elevatorsEl = document.getElementById('elevators');
  const elevators = [];
  for (let i = 0; i < ELEVATORS_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'elevator';
    el.style.left = (i * 70) + 'px';
    el.style.width = '60px';
    el.style.height = '50px';
    el.style.transform = `translateY(${(FLOORS - 1) * FLOOR_HEIGHT}px)`; // initial at ground (floor 0) -> bottom
    el.innerHTML = `<div class="id" data-floor="${i + 1}">E${i + 1} ⬤</div>`;
    el.style.backgroundColor = getComputedStyle(document.documentElement).getPropertyValue('--color-idle');
    elevatorsEl.appendChild(el);
    const e = new Elevator(i + 1, el, 0);
    elevators.push(e);
  }


  console.log("elevators init", elevators);

  // global pending call queue (FIFO)
  const pendingCalls = [];

  // handle button clicks
  document.querySelectorAll('.call-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const floor = parseInt(btn.dataset.floor, 10);
      // change to waiting
      console.log(btn.classList, btn.dataset.floor)
      btn.classList.add('waiting');
      btn.textContent = 'Waiting';
      // register call
      registerCall(floor);
    });
  });

  function registerCall(floor) {
    // create call object
    const call = { floor, ts: Date.now() };
    // try dispatch immediately
    if (!assignCallToBestElevator(call)) {
      // no elevator available -> push to pending
      pendingCalls.push(call);
    }
  }

  function assignCallToBestElevator(call) {
    // choose elevator with smallest distance and idle (prefer idle). If tie choose lower queue length
    let candidates = elevators.slice();
    // prefer idle first
    let idleList = candidates.filter(e => e.state === 'idle');

    let chosen = null;
    if (idleList.length > 0) {
      // select by smallest distance
      idleList.sort((a, b) => a.distanceTo(call.floor) - b.distanceTo(call.floor) || a.queue.length - b.queue.length);

      chosen = idleList[0];
    } else {
      // if none idle, choose elevator with smallest queue OR the one that will pass by soon (simple heuristic)
      candidates.sort((a, b) => a.queue.length - b.queue.length || a.distanceTo(call.floor) - b.distanceTo(call.floor));

      chosen = candidates[0];

    }

    if (!chosen) return false;
    // If the chosen elevator is moving and has many queued tasks, we still accept to not miss calls. We always assign.
    chosen.assign(call.floor);
    return true;
  }

  let idleList = elevators.map(e => e.id);


  function removeFromIdleList(floor) {
    const numericId = Number(floor);

    if (!Array.isArray(idleList)) {
      console.warn('idleList is not an array', idleList);
      return;
    }


    const idx = idleList.indexOf(numericId);
    if (idx !== -1) {
      idleList.splice(idx, 1);
    }


    const instance = elevators.find(ev => ev.id === numericId);
    if (instance) {
      instance.state = 'out-of-service';
    } else {
      console.warn('removeFromIdleList: no Elevator instance found for id', numericId);
    }
  }

  const elevatorsClick = document.querySelectorAll('.elevator');
  elevatorsClick.forEach(domEl => {
    domEl.addEventListener('click', () => {
      const idDiv = domEl.querySelector('.id');
      if (!idDiv) return;
      const floorOrId = Number(idDiv.dataset.floor);

      const instance = elevators.find(ev => ev.id === floorOrId);

      if (!instance) {
        console.warn('No Elevator instance for', floorOrId);
        return;
      }

      if (instance.state === 'out-of-service') return;

      instance.state = 'out-of-service';

      domEl.classList.add('flag-out-service', 'out');

      idDiv.textContent = `E${instance.id} - Out of Service`;

      removeFromIdleList(instance.id);

      console.log('Marked elevator out-of-service:', instance.id);
    });
  });


  function dispatchPendingCalls() {
    // try to assign all pending calls (FIFO)
    for (let i = 0; i < pendingCalls.length;) {
      const c = pendingCalls[i];
      if (assignCallToBestElevator(c)) {
        // remove from queue
        pendingCalls.splice(i, 1);
      } else i++;
    }
  }

  /* Simple beep via WebAudio */
  let audioCtx = null;
  function playBeep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 880;
      g.gain.value = 0.05;
      oscillator.connect(g); g.connect(audioCtx.destination);
      oscillator.start();
      setTimeout(() => { oscillator.stop(); }, 180);
    } catch (e) {
      // fallback: short silent audio object
      const a = new Audio();
      a.src = '';
    }
  }

  // Expose debug in window for quick inspection
  window._elevatorSystem = { elevators, pendingCalls, registerCall };

  // small demo: pre-park elevators on different floors to look nicer
  elevators.forEach((el, idx) => {
    console.log("idx", idx)
    const floor = Math.min(2, idx); // spread a bit
    console.log("floor", floor)
    el.currentFloor = floor;
    const y = (FLOORS - 1 - floor) * FLOOR_HEIGHT;
    el.el.style.transform = `translateY(${y}px)`;
  });

  // Accessibility: keyboard 1..0 to call floors 1..10
  window.addEventListener('keydown', ev => {
    const map = { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '0': 0 };
    if (map[ev.key] !== undefined) {
      const floor = map[ev.key];
      const btn = document.querySelector(`.call-btn[data-floor=\"${floor}\"]`);
      if (btn) btn.click();
    }
  });

})();