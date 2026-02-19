document.addEventListener("alpine:init", () => {
	Alpine.data("rhoApp", () => ({
		view: "chat",
		activeReviewCount: 0,
		_reviewPollId: null,

		init() {
			const qsView = new URLSearchParams(window.location.search).get("view");
			if (qsView && ["chat", "memory", "review", "config"].includes(qsView)) {
				this.view = qsView;
			}
			this._pollReviewSessions();
			this._reviewPollId = setInterval(() => this._pollReviewSessions(), 5000);
		},

		destroy() {
			if (this._reviewPollId) clearInterval(this._reviewPollId);
		},

		async _pollReviewSessions() {
			try {
				const res = await fetch("/api/review/sessions");
				if (!res.ok) return;
				const sessions = await res.json();
				this.activeReviewCount = sessions.filter((s) => !s.done).length;
			} catch {
				/* ignore */
			}
		},

		setView(nextView) {
			if (!["chat", "memory", "review", "config"].includes(nextView)) return;
			this.view = nextView;

			const url = new URL(window.location.href);
			if (nextView === "chat") url.searchParams.delete("view");
			else url.searchParams.set("view", nextView);
			window.history.replaceState(
				{},
				"",
				`${url.pathname}${url.search}${url.hash}`,
			);
		},
	}));
});
