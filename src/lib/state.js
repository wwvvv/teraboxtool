/**
 * state.js - 全局运行状态管理
 */
class State {
  constructor() {
    this.shouldStop = false;
  }

  reset() {
    this.shouldStop = false;
  }

  stop() {
    this.shouldStop = true;
  }

  check() {
    if (this.shouldStop) {
      throw new Error('TASK_STOPPED');
    }
  }
}

module.exports = new State();
