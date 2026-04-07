import { describe, it, expect, beforeEach, vi } from "vitest";
import { taskStore, TaskStore } from "../../../src/core/task-store.js";

describe("TaskStore", () => {
  beforeEach(() => {
    taskStore.clear();
  });

  describe("create", () => {
    it("should create a task with auto-incremented id", () => {
      const t1 = taskStore.create("Task 1", "Description 1");
      const t2 = taskStore.create("Task 2", "Description 2");

      expect(t1.id).toBe("1");
      expect(t1.subject).toBe("Task 1");
      expect(t1.description).toBe("Description 1");
      expect(t1.status).toBe("pending");

      expect(t2.id).toBe("2");
    });

    it("should create a task with steps", () => {
      const task = taskStore.create("Task with steps", "Desc", [
        { id: "1.1", title: "Step 1", status: "pending" },
        { id: "1.2", title: "Step 2", status: "pending" },
      ]);

      expect(task.steps).toHaveLength(2);
      expect(task.steps![0].title).toBe("Step 1");
      expect(task.steps![1].title).toBe("Step 2");
    });

    it("should auto-generate step ids if not provided", () => {
      const task = taskStore.create("Task", "Desc", [
        { title: "Auto step 1" },
        { title: "Auto step 2" },
      ]);

      expect(task.steps).toHaveLength(2);
      expect(task.steps![0].id).toBe("1.1");
      expect(task.steps![0].status).toBe("pending");
    });

    it("should accept activeForm", () => {
      const task = taskStore.create("Building", "Desc", undefined, "Building project");
      expect(task.activeForm).toBe("Building project");
    });
  });

  describe("get", () => {
    it("should return a task by id", () => {
      const task = taskStore.create("Get me", "Desc");
      expect(taskStore.get("1")).toEqual(task);
    });

    it("should return null for non-existent id", () => {
      expect(taskStore.get("999")).toBeNull();
    });
  });

  describe("update", () => {
    it("should update task status", () => {
      taskStore.create("Task", "Desc");
      const updated = taskStore.update("1", { status: "in_progress" });
      expect(updated?.status).toBe("in_progress");
    });

    it("should update multiple fields", () => {
      taskStore.create("Old Subject", "Old Desc");
      const updated = taskStore.update("1", {
        subject: "New Subject",
        description: "New Desc",
        status: "completed",
        activeForm: "Done",
      });
      expect(updated?.subject).toBe("New Subject");
      expect(updated?.description).toBe("New Desc");
      expect(updated?.status).toBe("completed");
      expect(updated?.activeForm).toBe("Done");
    });

    it("should update steps", () => {
      taskStore.create("Task", "Desc", [
        { id: "1.1", title: "Step 1", status: "pending" },
      ]);
      const updated = taskStore.update("1", {
        steps: [
          { id: "1.1", title: "Step 1", status: "completed" },
          { title: "New Step" },
        ],
      });
      expect(updated?.steps).toHaveLength(2);
      expect(updated?.steps![0].status).toBe("completed");
      expect(updated?.steps![1].title).toBe("New Step");
    });

    it("should delete task when status is 'deleted'", () => {
      taskStore.create("Delete me", "Desc");
      const result = taskStore.update("1", { status: "deleted" });
      expect(result).toBeNull();
      expect(taskStore.get("1")).toBeNull();
    });

    it("should return null for non-existent task", () => {
      const result = taskStore.update("999", { status: "completed" });
      expect(result).toBeNull();
    });
  });

  describe("list", () => {
    it("should return empty array when no tasks", () => {
      expect(taskStore.list()).toEqual([]);
    });

    it("should return tasks ordered by id", () => {
      taskStore.create("C Task", "C");
      taskStore.create("A Task", "A");
      taskStore.create("B Task", "B");
      const list = taskStore.list();

      expect(list).toHaveLength(3);
      expect(list[0].subject).toBe("C Task");
      expect(list[1].subject).toBe("A Task");
      expect(list[2].subject).toBe("B Task");
    });
  });

  describe("hasActiveTasks", () => {
    it("should return false when no tasks", () => {
      expect(taskStore.hasActiveTasks()).toBe(false);
    });

    it("should return true when pending tasks exist", () => {
      taskStore.create("Pending", "Desc");
      expect(taskStore.hasActiveTasks()).toBe(true);
    });

    it("should return true when in_progress tasks exist", () => {
      taskStore.create("Active", "Desc");
      taskStore.update("1", { status: "in_progress" });
      expect(taskStore.hasActiveTasks()).toBe(true);
    });

    it("should return true when all tasks are completed (completed tasks still count as active per source logic)", () => {
      taskStore.create("Done", "Desc");
      taskStore.update("1", { status: "completed" });
      // Source code: returns true when tasks.size > 0, even if all completed
      expect(taskStore.hasActiveTasks()).toBe(true);
    });
  });

  describe("clear", () => {
    it("should clear all tasks", () => {
      taskStore.create("Task 1", "Desc");
      taskStore.create("Task 2", "Desc");
      taskStore.clear();
      expect(taskStore.list()).toEqual([]);
      expect(taskStore.get("1")).toBeNull();
    });

    it("should reset id counter", () => {
      taskStore.create("Task", "Desc");
      taskStore.clear();
      const newTask = taskStore.create("New Task", "Desc");
      expect(newTask.id).toBe("1");
    });
  });

  describe("onChange", () => {
    it("should call listener on create", () => {
      const listener = vi.fn();
      const unsub = taskStore.onChange(listener);
      taskStore.create("Task", "Desc");
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it("should call listener on update", () => {
      taskStore.create("Task", "Desc");
      const listener = vi.fn();
      const unsub = taskStore.onChange(listener);
      taskStore.update("1", { status: "in_progress" });
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it("should call listener on clear", () => {
      taskStore.create("Task", "Desc");
      const listener = vi.fn();
      const unsub = taskStore.onChange(listener);
      taskStore.clear();
      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it("should unsubscribe correctly", () => {
      const listener = vi.fn();
      const unsub = taskStore.onChange(listener);
      unsub();
      taskStore.create("Task", "Desc");
      expect(listener).not.toHaveBeenCalled();
    });

    it("should handle listener errors gracefully", () => {
      const badListener = () => { throw new Error("oops"); };
      const goodListener = vi.fn();
      taskStore.onChange(badListener);
      taskStore.onChange(goodListener);
      expect(() => taskStore.create("Task", "Desc")).not.toThrow();
      expect(goodListener).toHaveBeenCalledTimes(1);
    });
  });
});
