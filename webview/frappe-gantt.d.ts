declare module 'frappe-gantt' {
  export default class Gantt {
    constructor(wrapper: HTMLElement | string, tasks: unknown[], options?: Record<string, unknown>);
    refresh(tasks: unknown[]): void;
    change_view_mode(mode?: string): void;
  }
}
