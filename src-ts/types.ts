export interface Task {
  id: number;
  title: string;
  start_time: string; // "YYYY-MM-DDTHH:MM:SS", local time, no offset
  end_time: string;
  completed: boolean;
  reminder_enabled: boolean;
  reminder_minutes_before: number;
  reminder_fired: boolean;
  order_index: number;
  created_at: string;
}

export interface NewTaskInput {
  title: string;
  start_time: string;
  end_time: string;
  reminder_enabled?: boolean;
  reminder_minutes_before?: number;
}

export interface UpdateTaskInput {
  id: number;
  title?: string;
  start_time?: string;
  end_time?: string;
  completed?: boolean;
  reminder_enabled?: boolean;
  reminder_minutes_before?: number;
}

export interface BulkCreateInput {
  titles: string[];
  duration_minutes: number;
  start_time: string;
}

declare global {
  interface Window {
    __TAURI__: {
      core: {
        invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      };
    };
  }
}
