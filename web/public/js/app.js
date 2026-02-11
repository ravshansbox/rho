document.addEventListener('alpine:init', () => {
  Alpine.data('rhoApp', () => ({
    view: 'chat',
    activeReviewCount: 0,
    _reviewPollId: null,

    init() {
      this._pollReviewSessions();
      this._reviewPollId = setInterval(() => this._pollReviewSessions(), 5000);
    },

    destroy() {
      if (this._reviewPollId) clearInterval(this._reviewPollId);
    },

    async _pollReviewSessions() {
      try {
        const res = await fetch('/api/review/sessions');
        if (!res.ok) return;
        const sessions = await res.json();
        this.activeReviewCount = sessions.filter(s => !s.done).length;
      } catch { /* ignore */ }
    },

    setView(nextView) {
      this.view = nextView;
    }
  }));
});
