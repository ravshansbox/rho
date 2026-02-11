document.addEventListener("alpine:init", () => {
  Alpine.data("rhoMemory", () => ({
    entries: [],
    displayEntries: [],
    stats: { total: 0, learnings: 0, preferences: 0, tasks: 0, reminders: 0, categories: [] },
    typeFilter: "all",
    categoryFilter: "",
    searchQuery: "",
    sortBy: "created",
    isLoading: false,
    error: "",

    // Task creation state
    newTaskDescription: "",
    newTaskPriority: "normal",

    async init() {
      console.log('[rho-memory] init called');
      await this.load();
    },

    setType(type) {
      this.typeFilter = type;
      this.load();
    },

    updateDisplay() {
      const sorted = [...this.entries].sort((a, b) => {
        switch (this.sortBy) {
          case "used":
            return (b.used || 0) - (a.used || 0);
          case "alpha": {
            const aText = a.text || a.description || "";
            const bText = b.text || b.description || "";
            return aText.localeCompare(bText);
          }
          case "last_used":
            return (b.last_used || "").localeCompare(a.last_used || "");
          case "created":
          default:
            return (b.created || "").localeCompare(a.created || "");
        }
      });
      this.displayEntries = sorted;
    },

    async load() {
      this.isLoading = true;
      this.error = "";
      try {
        const params = new URLSearchParams();
        if (this.typeFilter !== "all") params.set("type", this.typeFilter);
        if (this.categoryFilter) params.set("category", this.categoryFilter);
        if (this.searchQuery.trim()) params.set("q", this.searchQuery.trim());

        const res = await fetch(`/api/memory?${params}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Request failed (${res.status})`);
        }
        const data = await res.json();
        this.entries = data.entries;
        this.stats = {
          total: data.total,
          learnings: data.learnings,
          preferences: data.preferences,
          tasks: data.tasks ?? 0,
          reminders: data.reminders ?? 0,
          categories: data.categories,
        };
        this.updateDisplay();
        console.log('[rho-memory] loaded', this.entries.length, 'entries, display:', this.displayEntries.length);
      } catch (err) {
        this.error = err.message || "Failed to load memory";
        console.error('[rho-memory] load error:', err);
      } finally {
        this.isLoading = false;
        console.log('[rho-memory] isLoading:', this.isLoading, 'entries:', this.entries.length);
      }
    },

    changeSort() {
      this.updateDisplay();
    },

    isStale(entry) {
      if (!entry.last_used) return false;
      const days = (Date.now() - new Date(entry.last_used).getTime()) / 86400000;
      return days > 14;
    },

    async remove(entry) {
      if (!confirm(`Delete memory entry?\n\n"${(entry.text || entry.description || "").substring(0, 100)}..."`)) return;
      try {
        const res = await fetch(`/api/memory/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Delete failed");
        }
        await this.load();
      } catch (err) {
        this.error = err.message || "Failed to delete entry";
      }
    },

    // ── Task methods ──

    async addTask() {
      const desc = this.newTaskDescription.trim();
      if (!desc) return;
      this.error = "";
      try {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: desc, priority: this.newTaskPriority }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to add task");
        }
        this.newTaskDescription = "";
        this.newTaskPriority = "normal";
        await this.load();
      } catch (err) {
        this.error = err.message || "Failed to add task";
      }
    },

    async toggleTask(task) {
      if (!task) return;
      const nextStatus = task.status === "done" ? "pending" : "done";
      this.error = "";
      try {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to update task");
        }
        await this.load();
      } catch (err) {
        this.error = err.message || "Failed to toggle task";
      }
    },

    async removeTask(task) {
      if (!task) return;
      this.error = "";
      try {
        const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || "Failed to delete task");
        }
        await this.load();
      } catch (err) {
        this.error = err.message || "Failed to delete task";
      }
    },
  }));
});
