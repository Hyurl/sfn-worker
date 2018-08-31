import { EventEmitter } from "events";
import * as cluster from "cluster";
import values = require("lodash/values");
import filter = require("lodash/filter");
import assign = require("lodash/assign");

const ClusterWorkers: { [name: string]: cluster.Worker } = {};
const Workers: { [name: string]: Worker } = {};

var onReboot = Symbol("onReboot");
var MaxListeners = 0;
var isNode6 = parseInt(process.version.slice(1)) >= 6;
var WorkerPids: {
    [pid: number]: {
        id: string;
        keepAlive: boolean;
        reborn: boolean;
    }
} = {};

class Worker extends EventEmitter {
    id: string;
    pid: number;
    keepAlive: boolean;
    state: "connecting" | "online" | "closed" = "connecting";
    rebootTimes = 0;
    protected receivers: string[] = [];

    protected static receivers: string[] = [];

    /**
     * @param id An unique ID of the worker.
     * @param keepAlive If `true`, when the worker process accidentally exits,
     *  create a new one to replace it immediately. default is `false`.
     */
    constructor(id: string, keepAlive: boolean = false) {
        super();

        this.id = id;
        this.keepAlive = keepAlive;

        if (cluster.isMaster && (!Workers[id] || Workers[id].state == "closed"))
            createWorker(this);
    }

    /** Whether the worker process is connected (`online`). */
    isConnected() {
        return this.state == "online";
    }

    /** Whether the worker process is dead (`closed`). */
    isDead() {
        return this.state == "closed";
    }

    /**
     * Adds a listener function to an event.
     * @param listener An event listener function, it may accept parameters, 
     *  which are the data sent by the other end of the worker, or other 
     *  workers.
     */
    on(event: "error", listener: (err: Error) => void): this;
    on(event: "exit", listener: (code: number, signal: string) => void): this;
    on(event: string | symbol, listener: (...data: any[]) => void): this;
    on(event: string | symbol, listener: (...data: any[]) => void): this {
        if (cluster.isMaster) {
            if (event == "error" || event == "exit") {
                super.on(event, listener);
            } else {
                cluster.on("message", (worker, msg) => {
                    msg = isNode6 ? msg : worker;

                    if (msg && msg.id == this.id && msg.event == event) {
                        listener.call(this, ...msg.data);
                    }
                });
            }
        } else {
            process.on(<any>event, listener);
        }

        return this;
    }

    /**
     * Adds a listener function to an event that will be run only once.
     * @param listener An event listener function, it may accept parameters, 
     *  which are the data sent by the other end of the worker, or other 
     *  workers.
     */
    once(event: "error", listener: (err: Error) => void): this;
    once(event: "exit", listener: (code: number, signal: string) => void): this;
    once(event: string | symbol, listener: (...data: any[]) => void): this;
    once(event: string | symbol, listener: (...data: any[]) => void): this {
        if (cluster.isMaster) {
            if (event == "error" || event == "exit") {
                super.once(event, listener);
            } else {
                cluster.once("message", (worker, msg) => {
                    msg = isNode6 ? msg : worker;

                    if (msg && msg.id == this.id && msg.event == event) {
                        listener.call(this, ...msg.data);
                    }
                });
            }
        } else {
            process.once(<any>event, listener);
        }

        return this;
    }

    /**
     * Emits an event to the other end of the worker.
     * @param data A list of data, they will be received by event listeners.
     */
    emit(event: string | symbol, ...data: any[]): boolean {
        if (event == "online")
            return false;

        if (cluster.isMaster) {
            if (event == "error" || event == "exit") {
                super.emit(event, ...data);
            } else if (this.receivers.length) {
                for (let id of this.receivers) {
                    if (ClusterWorkers[id])
                        ClusterWorkers[id].send({ event, data });
                }

                this.receivers = [];
            } else if (ClusterWorkers[this.id]) {
                ClusterWorkers[this.id].send({ event, data });
            }
        } else {
            if (event == "error" || event == "exit") {
                process.emit.call(process, event, ...data);
            } else if (this.receivers.length) {
                process.send({
                    id: this.id,
                    event: "----transmit----",
                    data: { receivers: this.receivers, event, data }
                });

                this.receivers = [];
            } else {
                process.send({ id: this.id, event, data });
            }
        }

        return true;
    }

    /** Sets receivers that the event will only be emitted to them. */
    to(...workers: Array<string | Worker>): this;
    to(workers: Array<string | Worker>): this;
    to(...workers) {
        if (workers[0] instanceof Array) {
            workers = workers[0];
        }

        for (let i in workers) {
            // If workers are passed, then get their IDs.
            if (workers[i] instanceof Worker)
                workers[i] = workers[i].id;
        }

        this.receivers = this.receivers.concat(<string[]>workers);

        return this;
    }

    /** Emits an event to all workers (the current one included). */
    broadcast(event: string | symbol, ...data: any[]): boolean {
        if (event == "online" || event == "error" || event == "exit")
            return false;

        if (cluster.isMaster) {
            for (let id in ClusterWorkers) {
                ClusterWorkers[id].send({ event, data });
            }
        } else {
            process.send({
                id: this.id,
                event: "----broadcast----",
                data: { event, data }
            });
        }

        return true;
    }

    /** 
     * Gets all connected workers.
     * @deprecated use static `Worker.getWorkers()` instead.
     */
    // getWorkers(): Promise<this[]>;
    // getWorkers(cb: (err: Error, workers: this[]) => void): void;
    // getWorkers(cb?: (err: Error, workers: this[]) => void): void | Promise<this[]> {
    //     return (<typeof Worker>this.constructor).getWorkers(cb);
    // }

    /** Terminates the current worker. */
    exit(): void {
        if (cluster.isMaster) {
            ClusterWorkers[this.id].kill();
        } else {
            process.exit();
        }
    }

    /**
     * Restarts the current worker.
     * @param cb The callback function can only be set in the master process.
     */
    reboot(cb?: () => void): void {
        if (cluster.isMaster) {
            if (cb !== undefined) this[onReboot] = cb;

            this.state = "closed";
            ClusterWorkers[this.id].send("----reboot----");
        } else {
            if (cb !== undefined)
                throw new Error("The callback function can only be set in the master process.");

            process.exit(826); // 826 indicates reboot code.
        }
    }

    setMaxListeners(n: number): this {
        super.setMaxListeners(n);

        if (cluster.isMaster) {
            let max = MaxListeners;

            for (let i in Workers) {
                if (Workers[i].isConnected())
                    max += Workers[i].getMaxListeners();
            }

            cluster.setMaxListeners(max);
        } else {
            process.setMaxListeners(n);
        }

        return this;
    }

    /** Adds a listener function to event `online`. */
    static on(event: "online", listener: (worker: Worker) => void): typeof Worker;
    /** Adds a listener function to event `exit`. */
    static on(event: "exit", listener: (worker: Worker, code: number, signal: string) => void): typeof Worker;
    static on(event: "online" | "exit", listener: Function): typeof Worker {
        if (cluster.isMaster) {
            if (event == "online") {
                MaxListeners += 1;
                cluster.setMaxListeners(cluster.getMaxListeners() + 1);

                cluster.on("online", worker => {
                    let { id, reborn } = WorkerPids[worker.process.pid];

                    if (!reborn) {
                        // Reborn workers do not emit this event.
                        listener(Workers[id]);
                    }
                });
            } else if (event == "exit") {
                MaxListeners += 1;
                cluster.setMaxListeners(cluster.getMaxListeners() + 1);

                cluster.on("exit", (worker, code, signal) => {
                    let { id, keepAlive } = WorkerPids[worker.process.pid];

                    // Keep-alive workers only emit this event once.
                    if (!code || (code && !keepAlive)) {
                        listener(Workers[id], code, signal);
                    }
                });
            }
        } else {
            if (event == "online") {
                process.on("message", msg => {
                    if (msg && msg.event == event) {
                        let { id, keepAlive } = msg.data[0];

                        if (!Workers[id]) {
                            // Initiate worker instance.
                            Workers[id] = new this(id, keepAlive);
                            assign(Workers[id], msg.data[0]);
                            Workers[id].state = "online";
                            WorkerPids[process.pid] = {
                                id,
                                keepAlive,
                                reborn: false
                            };

                            // Emit event for Worker.getWorker().
                            process.emit(<any>"----online----", id);
                        }

                        listener(Workers[id]);
                    }
                });
            } else if (event == "exit") {
                process.on(<any>"exit", (code, signal) => {
                    let { id, keepAlive } = WorkerPids[process.pid];

                    // Keep-alive workers only emit this event once.
                    if (!code || (code && !keepAlive)) {
                        listener(Workers[id], code, signal);
                    }
                });
            }
        }

        return this;
    }

    /**
     * (**master only**) Emits an event to some worker process(es). If you 
     * don't call `Worker.to()` before calling this method, then it will act 
     * the same as broadcast.
     */
    static emit(event: string | symbol, ...data: any[]): boolean {
        if (event == "online" || event == "error" || event == "exit")
            return false;

        if (cluster.isMaster) {
            if (!this.receivers.length) {
                return this.broadcast(event, ...data);
            } else {
                for (let id of this.receivers) {
                    if (ClusterWorkers[id])
                        ClusterWorkers[id].send({ event, data });
                }

                this.receivers = [];
            }
        } else {
            throw new ReferenceError(`Cannot call static method '${this["name"]}.emit()' in a worker process.`);
        }

        return true;
    }

    /** 
     * (**master only**) Sets receivers that the event will only be emitted to
     * them.
     */
    static to(...workers: Array<string | Worker>): typeof Worker;
    static to(workers: Array<string | Worker>): typeof Worker;
    static to(...workders) {
        if (cluster.isMaster) {
            if (workders[0] instanceof Array) {
                workders = workders[0];
            }

            for (let i in workders) {
                // If workers are passed, then get their IDs.
                if (workders[i] instanceof Worker)
                    workders[i] = workders[i].id;
            }

            this.receivers = this.receivers.concat(workders);
        } else {
            throw new ReferenceError(`Cannot call static method '${this["name"]}.to()' in a worker process.`);
        }

        return this;
    }

    /** (**master only**) Emits an event to all workers (worker processes). */
    static broadcast(event: string | symbol, ...data: any[]): boolean {
        if (event == "online" || event == "error" || event == "exit")
            return false;

        if (cluster.isMaster) {
            for (let id in ClusterWorkers) {
                ClusterWorkers[id].send({ event, data });
            }
        } else {
            throw new ReferenceError(`Cannot call static method '${this["name"]}.broadcast()' in a worker process.`);
        }

        return true;
    }

    /** Gets all connected workers. */
    static getWorkers(): Promise<Worker[]>;
    static getWorkers(cb: (err: Error, workers: Worker[]) => void): void;
    static getWorkers(cb?: (err: Error, workers: Worker[]) => void) {
        if (cb) {
            if (this.isMaster) {
                process.nextTick(() => {
                    cb(null, filter(values(Workers), worker => worker.isConnected()));
                });
            } else {
                let worker = values(Workers)[0];

                if (worker) {
                    let timer = setTimeout(() => {
                        let err = new Error("Have been waiting too long to fetch workers.");
                        cb(err, null);
                        cb = null;
                    }, 2000);

                    worker.once("----get-workers----", workers => {
                        clearTimeout(timer);
                        if (!cb) return;

                        try {
                            for (let i in workers) {
                                if (workers[i].id == worker.id) {
                                    workers[i] = worker;
                                } else {
                                    let _worker = new this(workers[i].id, workers[i].keepAlive);
                                    assign(_worker, workers[i]);
                                    workers[i] = _worker;
                                }
                            }

                            cb(null, workers);
                        } catch (err) {
                            cb(err, null);
                        }
                    }).emit("----get-workers----");
                } else {
                    process.once(<any>"----online----", () => {
                        this.getWorkers(cb);
                    });
                }
            }
        } else {
            return new Promise((resolve, reject) => {
                this.getWorkers((err, workers) => {
                    err ? reject(err) : resolve(workers);
                });
            });
        }
    }

    /** (**worker only**) Gets the current worker. */
    static getWorker(): Promise<Worker>;
    static getWorker(cb: (err: Error, worker: Worker) => void): void;
    static getWorker(cb?: (err: Error, worker: Worker) => void) {
        if (this.isMaster) {
            throw new Error(`Cannot call static method '${this["name"]}.getWorker()' in the master process.`);
        }

        if (cb) {
            let worker = values(Workers)[0];

            if (worker) {
                process.nextTick(() => {
                    cb(null, worker);
                });
            } else {
                let timer = setTimeout(() => {
                    let err = new Error("Have been waiting too long to fetch the worker instance.");
                    cb(err, null);
                    cb = null;
                }, 2000);

                process.once(<any>"----online----", id => {
                    clearTimeout(timer);
                    if (!cb) return;
                    cb(null, Workers[id]);
                });
            }
        } else {
            return new Promise((resolve, reject) => {
                this.getWorker((err, worker) => {
                    err ? reject(err) : resolve(worker);
                });
            });
        }
    }
}

const WorkerConstructor = Worker;

namespace Worker {
    /** Whether the process is the master. */
    export const isMaster: boolean = cluster.isMaster;

    /** Whether the process is a worker. */
    export const isWorker: boolean = cluster.isWorker;

    export const Worker: typeof WorkerConstructor = WorkerConstructor;
}

export = Worker;

/** Creates worker process. */
function createWorker(target: Worker, reborn = false) {
    let { id, keepAlive } = target,
        worker = cluster.fork();

    if (reborn) {
        // when reborn, copy event listeners and remove unused worker-pid pairs.
        target["_events"] = Workers[id]["_events"];
        target["_eventCount"] = Workers[id]["_eventCount"];
        target["_maxListeners"] = Workers[id]["_maxListeners"];
        // WorkerPids = filter(WorkerPids, data => data.id != target.id);
    }

    target.pid = worker.process.pid;
    Workers[id] = target;
    ClusterWorkers[id] = worker;
    WorkerPids[worker.process.pid] = { id, keepAlive, reborn };

    worker.on("online", () => {
        target.state = "online";
        worker.send({
            event: "online",
            data: [target]
        });
    }).on("exit", (code, signal) => {
        if ((code || signal == "SIGKILL") && keepAlive || code === 826) {
            // If a worker exits accidentally, create a new one.
            target.rebootTimes++;
            createWorker(target, true);

            if (code === 826 && target[onReboot]) {
                target[onReboot].call(target);
                delete target[onReboot];
            }
        } else {
            target.state = "closed";
            target.emit("exit", code, signal);

            delete ClusterWorkers[id];
        }
    }).on("error", err => {
        target.emit("error", err);
    });
}

// Prepare workers.
if (cluster.isMaster) {
    // Handle transmit and broadcast.
    cluster.on("message", (worker, msg) => {
        msg = isNode6 ? msg : worker;

        if (typeof msg == "object") {
            if (msg.event == "----transmit----") {
                msg = msg.data;
                Worker.to(msg.receivers).emit(msg.event, ...msg.data);
            } else if (msg.event == "----broadcast----") {
                msg = msg.data;
                Worker.broadcast(msg.event, ...msg.data);
            }
        }
    });

    Worker.on("online", worker => {
        // Handle requests to get workers from a worker.
        worker.on("----get-workers----", () => {
            let workers = filter(values(Workers), worker => {
                return worker.isConnected();
            });
            worker.emit("----get-workers----", workers);
        });
    });
} else {
    // Trigger events when receiving messages.
    process.on("message", (msg) => {
        if (msg && msg.event) {
            process.emit.call(process, msg.event, ...msg.data);
        } else if (msg == "----reboot----") {
            process.exit(826);
        }
    });
}