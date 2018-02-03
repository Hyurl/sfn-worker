import { EventEmitter } from "events";

declare class Worker extends EventEmitter {
    id: string;
    keepAlive: boolean;
    protected receivers: string[];

    /**
     * @param id An unique ID of the worker.
     * @param keepAlive If `true`, when the worker process accidentally exits,
     *  create a new one to replace it immediately. default is `false`.
     */
    constructor(id: string, keepAlive?: boolean);

    /**
     * Adds a listener function to an event.
     * @param listener An event listener function, it may accept parameters, 
     *  which are the data sent by the other end of the worker, or other 
     *  workers.
     */
    on(event: string | symbol, listener: (...data: any[]) => void): this;

    /**
     * Adds a listener function to an event that will be run only once.
     * @param listener An event listener function, it may accept parameters, 
     *  which are the data sent by the other end of the worker, or other 
     *  workers.
     */
    once(event: string | symbol, listener: (...data: any[]) => void): this;

    /**
     * Emits an event to the other end of the worker.
     * @param data A list of data, they will be received by event listeners.
     */
    emit(event: string | symbol, ...data: any[]): boolean;

    /** Sets receivers that the event will only be emitted to them. */
    to(...ids: string[]): this;
    to(...workers: Worker[]): this;
    to(ids: string[]): this;
    to(workers: Worker[]): this;

    /** Emits an event to all workers (the current one included). */
    broadcast(event: string | symbol, ...data: any[]): boolean;

    /** Gets all workers. */
    getWorkers(): Promise<this[]>;
    getWorkers(cb: (workers: this[]) => void): void;

    /** Terminates the current worker. */
    exit(): void;

    /** Restarts the current worker. */
    reboot(): void;

    setMaxListeners(n: number): this;

    /** Whether the process is the master. */
    static readonly isMaster: boolean;

    /** Whether the process is a worker. */
    static readonly isWorker: boolean;

    static readonly Worker: typeof Worker;
    
    /** Adds a listener function to event `online` or `exit`. */
    static on(event: "online" | "exit", listener: (worker: Worker) => void): typeof Worker;

    /**
     * Emits an event to some worker process(es). If you don't call
     * `Worker.to()` before calling this method, then it will act the same
     * as broadcast.
     */
    static emit(event: string | symbol, ...data: any[]): boolean;

    /** Sets receivers that the event will only be emitted to them. */
    static to(...ids: string[]): typeof Worker;
    static to(...workers: Worker[]): typeof Worker;
    static to(ids: string[]): typeof Worker;
    static to(workers: Worker[]): typeof Worker;

    /** Emits an event to all workers (worker processes). */
    static broadcast(event: string | symbol, ...data: any[]): boolean;

    /** Gets all workers. */
    static getWorkers(): Promise<Worker[]>;
    static getWorkers(cb: (workers: Worker[]) => void): void;

    /** Gets the current worker. */
    static getWorker(): Promise<Worker>;
    static getWorker(cb: (worker: Worker) => void): void;
}

export = Worker;