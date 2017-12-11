const cluster = require("cluster");
const ClusterWorkers = {};
const WorkerPids = {};
const Workers = {};
const ReservedEvents = ["online", "exit", "error"];

// polyfill of Object.values().
if (Object.values === undefined) {
    Object.values = (obj) => {
        var values = [];
        for (let i in obj) {
            values.push(obj[i]);
        }
        return values;
    }
}

/**
 * A tool for process management and communications. 
 * 
 * When you create a `new Worker`, a new worker process will be forked. You 
 * can keep a worker alive, so when it exits accidentally, a new one will be 
 * forked to replace it.
 * 
 * This module is designed as convenient as it can, many of its methods can be 
 * used both in the master or in a worker process, and you can add event 
 * listeners and emit events both in the master or in the worker process.
 * 
 * This module uses predictable and user-defined IDs to differ workers, so 
 * you can always know which is which.
 */
class Worker {
    /**
     * Creates a new worker.
     * 
     * @param {String} id An unique ID of the worker.
     * 
     * @param {Boolean} keepAlive If `true`, when the worker process 
     *  accidentally exits, create a new one to replace it immediately. 
     *  default is `false`.
     */
    constructor(id, keepAlive = false) {
        this.id = id;
        this.keepAlive = keepAlive;
        this.receivers = null;
        if (cluster.isMaster && !ClusterWorkers[id])
            createWorker(id, keepAlive);
    }

    /** 
     * Adds a listener function to an event.
     * 
     * @param {String} event The event name.
     * 
     * @param {(...data?: Any[])=>void} handler An event handler function, it 
     *  may accept parameters, which are the data sent by the other end of the
     *  worker, or other workers.
     * 
     * @return {Worker}
     */
    on(event, handler) {
        if (ReservedEvents.includes(event)) {
            this.constructor.on(event, handler);
        } else {
            if (cluster.isMaster) {
                cluster.on("message", (worker, msg) => {
                    if (msg && msg.id === this.id && msg.event === event) {
                        handler.call(this, ...msg.data);
                    }
                });
            } else {
                process.on(event, handler);
            }
        }
        return this;
    }

    /** 
     * Adds a listener function to an event that will be run only once.
     * 
     * @param {String} event The event name.
     * 
     * @param {(...data?: Any[])=>void} handler An event handler function, it
     *  may accept parameters, which are the data sent by the other end of the
     *  worker, or other workers.
     * 
     * @return {Worker}
     */
    once(event, handler) {
        if (ReservedEvents.includes(event)) {
            this.constructor.once(event, handler);
        } else {
            if (cluster.isMaster) {
                cluster.once("message", (worker, msg) => {
                    if (msg && msg.id === this.id && msg.event === event) {
                        handler.call(this, ...msg.data);
                    }
                });
            } else {
                process.once(event, handler);
            }
        }
        return this;
    }

    /**
     * Emits an event to the other end of the worker.
     * 
     * @param {String} event The event name.
     * 
     * @param {Any[]} [data] A list of data, they will be received by event 
     *  listeners.
     * 
     * @return {Boolean}
     */
    emit(event, ...data) {
        if (ReservedEvents.includes(event))
            return false;

        if (cluster.isMaster) {
            if (this.receivers) {
                for (let id of this.receivers) {
                    if (ClusterWorkers[id])
                        ClusterWorkers[id].send({ event, data });
                }
                this.receivers = null;
            } else if (ClusterWorkers[this.id]) {
                ClusterWorkers[this.id].send({ event, data });
            }
        } else {
            if (this.receivers) {
                process.send({
                    id: this.id,
                    event: "----transmit----",
                    data: { receivers: this.receivers, event, data }
                });
            } else {
                process.send({ id: this.id, event, data });
            }
        }
        return true;
    }

    /**
     * Sets receivers that the event will only be emitted to them.
     * 
     * @param {String[]} id The worker id, you can pass several ids at same 
     *  time to set several receivers.
     * 
     * @return {Worker}
     */
    to(...id) {
        if (id[0] instanceof Array) {
            id = id[0];
        }
        for (let i in id) {
            // If workers are passed, then get their IDs.
            if (id[i] instanceof Worker)
                id[i] = id[i].id;
        }
        this.receivers = id;
        return this;
    }

    /**
     * Emits an event to all workers (the current one included).
     * 
     * @param {String} event The event name.
     * 
     * @param {Any[]} [data] A list of data, they will be received by event 
     *  listeners.
     * 
     * @return {Boolean}
     */
    broadcast(event, ...data) {
        if (ReservedEvents.includes(event))
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
     * Gets all workers.
     * 
     * @param {(workers: Worker[])=>void} [cb] If you provide this callback 
     *  function, then it will be called when workers are got, otherwise, the 
     *  method will return a promise. The only parameter that this function 
     *  accepts is the returning workers.
     * 
     * @return {void | Promise<Worker[]>}
     */
    getWorkers(cb = null) {
        if (cluster.isMaster) {
            return this.constructor.getWorkers(cb);
        } else {
            if (cb instanceof Function) {
                this.once("----get-workers----", workers => {
                    for (let i in workers) {
                        workers[i] = new Worker(workers[i].id, workers[i].keepAlive);
                    }
                    cb(workers);
                }).emit("----get-workers----");
            } else {
                return new Promise(resolve => {
                    this.getWorkers(resolve);
                });
            }
        }
    }

    /** Terminates the current worker. */
    exit() {
        if (cluster.isMaster) {
            ClusterWorkers[this.id].kill();
            delete ClusterWorkers[this.id];
        } else {
            process.exit();
        }
    }

    /** Restarts the current worker. */
    reboot() {
        if (cluster.isMaster) {
            ClusterWorkers[this.id].kill();
            createWorker(this.id, this.keepAlive, true);
        } else {
            process.exit(826); // 826 indicates reboot code.
        }
    }

    /** Whether the process is the master. */
    static get isMaster() {
        return cluster.isMaster;
    }

    /** Whether the process is a worker. */
    static get isWorker() {
        return cluster.isWorker;
    }

    static get Worker() {
        return this;
    }

    /**
     * Adds a listener function to an event.
     * @inner
     */
    static _bind(event, handler, once = false) {
        var method = once ? "once" : "on";

        if (event === "online" && once) // once not workers with online.
            return this;

        if (cluster.isMaster) {
            if (event === "online") {
                cluster[method]("online", worker => {
                    var { id, keepAlive, reborn } = WorkerPids[worker.process.pid];
                    if (!reborn) {
                        // Reborn workers do not emit this event.
                        if (!Workers[id]) {
                            Workers[id] = new this(id, keepAlive);
                        }
                        handler(Workers[id]);
                    }
                });
            } else if (event === "exit") {
                cluster[method]("exit", (worker, code, signal) => {
                    var { id, keepAlive } = WorkerPids[worker.process.pid];
                    // Keep-alive workers only emit this event once.
                    if (!code || (code && !keepAlive)) {
                        handler(Workers[id], code, signal);
                    }
                });
            } else if (event === "error") {
                cluster[method]("error", (worker) => {
                    var { id } = WorkerPids[worker.process.pid];
                    handler(Workers[id]);
                });
            }
        } else {
            if (event === "online") {
                process[method]("message", msg => {
                    if (msg && msg.event === event) {
                        var { id, keepAlive } = msg.data[0];
                        if (!Workers[id]) {
                            // Initiate worker instance.
                            Workers[id] = new this(id, keepAlive);
                            WorkerPids[process.pid] = { id, keepAlive };
                            process.emit("----online----", id);
                        }
                        handler(Workers[id]);
                    }
                });
            } else if (event === "exit") {
                process[method]("exit", (code, signal) => {
                    var { id, keepAlive } = WorkerPids[process.pid];
                    // Keep-alive workers only emit this event once.
                    if (!code || (code && !keepAlive)) {
                        handler(Workers[id], code, signal);
                    }
                });
            } else if (event === "error") {
                process[method]("error", () => {
                    var { id } = WorkerPids[process.pid];
                    handler(Workers[id]);
                });
            }
        }
        return this;
    }

    /** 
     * Adds a listener function to an event, which accepts `online`, `exit` 
     * and `error`. All worker actions should be put in the callback function 
     * which pass the worker parameter.
     * 
     * @param {"online" | "exit" | "error"} event The event name.
     * 
     * @param {(worker: Worker)=>void} handler An event handler function, it 
     *  accepts only one parameter, which is the worker.
     * 
     * @return {Worker}
     */
    static on(event, handler) {
        return this._bind(event, handler);
    }

    /** 
     * Adds a listener function to an event that will be run only once, which 
     * accepts `exit` and `error`. All worker actions should be put in the 
     * callback function which pass the worker parameter.
     * 
     * @param {"exit" | "error"} event The event name.
     * 
     * @param {(worker: Worker)=>void} handler An event handler function, it 
     *  accepts only one parameter, which is the worker.
     * 
     * @return {Worker}
     */
    static once(event, handler) {
        return this._bind(event, handler, true);
    }

    /**
     * Emits an event to some worker process(es), if you don't call 
     * `Worker.to()` before calling this method, then it will act the same 
     * as broadcast.
     * 
     * @param {String} event The event name.
     * 
     * @param {Any[]} [data] A list of data, they will be received by event 
     *  listeners.
     */
    static emit(event, ...data) {
        if (ReservedEvents.includes(event))
            return false;

        if (cluster.isMaster) {
            if (!this.receivers) {
                return this.broadcast(event, ...data);
            } else {
                for (let id of this.receivers) {
                    if (ClusterWorkers[id])
                        ClusterWorkers[id].send({ event, data });
                }
                this.receivers = null;
            }
        } else {
            throw new ReferenceError(`Cannot call static method '${this.name}.emit()' in a worker process.`);
        }
        return true;
    }

    /**
     * Sets receivers that the event will only be emitted to them.
     * 
     * @param {String[]} id The worker id, you can pass several ids at same 
     *  time to set several receivers.
     * 
     * @return {Worker}
     */
    static to(...id) {
        if (cluster.isMaster) {
            if (id[0] instanceof Array) {
                id = id[0];
            }
            for (let i in id) {
                // If workers are passed, then get their IDs.
                if (id[i] instanceof Worker)
                    id[i] = id[i].id;
            }
            this.receivers = id;
        } else {
            throw new ReferenceError(`Cannot call static method '${this.name}.to()' in a worker process.`);
        }
        return this;
    }

    /**
     * Emits an event to all workers (worker processes).
     * 
     * @param {String} event The event name.
     * 
     * @param {Any[]} [data] A list of data, they will be received by event 
     *  listeners.
     */
    static broadcast(event, ...data) {
        if (ReservedEvents.includes(event))
            return false;

        if (cluster.isMaster) {
            for (let id in ClusterWorkers) {
                ClusterWorkers[id].send({ event, data });
            }
        } else {
            throw new ReferenceError(`Cannot call static method '${this.name}.broadcast()' in a worker process.`);
        }
        return true;
    }

    /**
     * Gets all workers.
     * 
     * @param {(workers: Worker[])=>void} [cb] If you provide this callback 
     *  function, then it will be called when workers are got, otherwise, the 
     *  method will return a promise. The only parameter that this function 
     *  accepts is the returning workers.
     * 
     * @return {void | Promise<Worker[]>}
     */
    static getWorkers(cb = null) {
        if (cb instanceof Function) {
            if (this.isMaster) {
                cb(Object.values(Workers));
            } else {
                throw new ReferenceError(`Cannot call static method '${this.name}.getWorkers()' in a worker process.`);
            }
        } else {
            return new Promise(resolve => {
                this.getWorkers(resolve);
            });
        }
    }

    /** 
     * Gets the current worker.
     * 
     * @param {(worker: Worker)=>void} [cb] If you provide this callback 
     *  function, then it will be called when the worker is got, otherwise, 
     *  the method will return a promise. The only parameter that this 
     *  function accepts is the returning worker.
     * 
     * @return {void | Promise<Worker>}
     */
    static getWorker(cb = null) {
        if (this.isMaster) {
            throw new Error(`Cannot call static method '${this.name}.getChannel()' in the master process.`);
        }
        if (cb instanceof Function) {
            var id = Object.keys(Workers)[0];
            if (id) {
                cb(Workers[id]);
            } else {
                process.once("----online----", id => {
                    cb(Workers[id]);
                });
            }
        } else {
            return new Promise(resolve => {
                this.getChannel(resolve);
            });
        }
    }
}

/** Creates worker process. */
function createWorker(id, keepAlive, reborn = false) {
    var worker = cluster.fork();
    ClusterWorkers[id] = worker;
    WorkerPids[worker.process.pid] = { id, keepAlive, reborn };

    worker.on("online", () => {
        worker.send({
            event: "online",
            data: [{ id, keepAlive }]
        });
    }).on("exit", (code, signal) => {
        if ((code || signal == "SIGKILL") && keepAlive || code === 826) {
            // If a worker exits accidentally, create a new one.
            createWorker(id, keepAlive, true);
        } else {
            delete ClusterWorkers[id];
        }
        // delete WorkerPids[worker.process.pid];
    }).on("error", err => {
        // If any error occurs, kill the worker process.
        worker.kill("SIGKILL");
    });
}

// Prepare workers.
if (cluster.isMaster) {
    // Handle transmit and broadcast.
    cluster.on("message", (worker, msg) => {
        if (msg && msg.event == "----transmit----") {
            msg = msg.data;
            Worker.to(msg.receivers).emit(msg.event, ...msg.data);
        } else if (msg && msg.event == "----broadcast----") {
            msg = msg.data;
            Worker.broadcast(msg.event, ...msg.data);
        }
    });

    Worker.on("online", worker => {
        // Handle requests to get workers from a worker.
        worker.on("----get-workers----", () => {
            worker.emit("----get-workers----", Object.values(Workers));
        });
    });
} else {
    // Trigger events when receiving messages.
    process.on("message", (msg) => {
        if (msg && msg.event) {
            process.emit(msg.event, ...msg.data);
        }
    });
}

module.exports = Worker;