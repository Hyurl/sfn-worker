var Worker = require(".");
var assert = require("assert");

if (Worker.isMaster) {
    // Master process
    // Create two workers A and B.
    new Worker("A", true);
    new Worker("B");

    // Do logics when the worker is online.
    Worker.on("online", function (worker) {
        worker.on("greeting from worker", function (msg) {
            assert.equal(msg, "Hi, Master, I'm worker " + worker.id + "!");

            // greet back
            var ok = worker.emit("greeting from master", "Hello, Worker " + worker.id + "!");
            assert.strictEqual(ok, true);
        });

        worker.emit("transmit object", {
            hello: "world",
            arr: [1, 2, 3]
        });

        if (worker.id == "B") {
            Worker.broadcast("master broadcast", "This is a broadcast message from master.");
            Worker.to("B").emit("private message from master", "This is a private message from master.");
        } else {
            Worker.to("A").emit("private message from master", "This is a private message from master.");
        }
    }).on("exit", function (worker, code) {
        assert.equal(typeof code, "number");
    });

    setTimeout(function () {
        Worker.getWorkers(function (workers) {
            assert.strictEqual(workers.length, 2);
            assert.strictEqual(workers[0].isConnected(), true);
            assert.strictEqual(workers[1].isConnected(), true);

            Worker.getWorkers().then(function (workers) {
                assert.strictEqual(workers.length, 2);
                assert.strictEqual(workers[0].isConnected(), true);
                assert.strictEqual(workers[1].isConnected(), true);

                console.log("#### OK ####");
                process.exit();
            }).catch(function (err) {
                console.log(err.stack);
                process.exit(1);
            });
        });

        try {
            Worker.getWorker();
        } catch (err) {
            assert.equal(err.message, "Cannot call static method 'Worker.getWorker()' in the master process.");
        }
    }, 1000);
} else {
    var msgCount = 0;
    var workerId = "";

    // Worker process
    Worker.on("online", function (worker) {
        workerId = worker.id;

        worker.emit("greeting from worker", "Hi, Master, I'm worker " + worker.id + "!");

        worker.on("greeting from master", function (msg) {
            assert.equal(msg, "Hello, Worker " + worker.id + "!");
            msgCount++;
        }).on("greeting from another worker", function (id, msg) {
            assert.equal(msg, "Hi, worker B, I'm worker A!");
            msgCount++

            // greet back
            worker.to(id).emit("greeting back to another worker", worker.id, "Nice to meet you, worker " + id + "!");
        }).on("greeting back to another worker", function (id, msg) {
            assert.equal(msg, "Nice to meet you, worker " + worker.id + "!");
            msgCount++;
        }).on("transmit object", function (obj) {
            assert.deepStrictEqual(obj, {
                hello: "world",
                arr: [1, 2, 3]
            });
            msgCount++;
        }).on("master broadcast", function (msg) {
            assert.equal(msg, "This is a broadcast message from master.");
            msgCount++;
        }).on("private message from master", function (msg) {
            assert.equal(msg, "This is a private message from master.");
            msgCount++;
        }).on("worker broadcast", function (msg) {
            assert.equal(msg, "This is a broadcast message from worker B.");
            msgCount++;
        });

        if (worker.id == "A") {
            worker.to("B").emit("greeting from another worker", "A", "Hi, worker B, I'm worker A!");
        } else if (worker.id == "B") {
            worker.broadcast("worker broadcast", "This is a broadcast message from worker B.");

            Worker.getWorkers(function (workers) {
                assert.strictEqual(workers.length, 2);
                assert.strictEqual(workers[0].isConnected(), true);
                assert.strictEqual(workers[1].isConnected(), true);
            });

            Worker.getWorkers().then(function (workers) {
                assert.strictEqual(workers.length, 2);
                assert.strictEqual(workers[0].isConnected(), true);
                assert.strictEqual(workers[1].isConnected(), true);
            }).catch(function (err) {
                process.exit(1);
            });
        }
    });

    setTimeout(function () {
        assert.strictEqual(msgCount, 6);

        Worker.getWorker().then(function (worker) {
            assert.ok(worker.isConnected());
            assert.ok(!worker.isDead());
            assert.strictEqual(workerId, worker.id);
            assert.strictEqual(worker.isConnected(), true);
        });

        try {
            Worker.emit("some event");
        } catch (err) {
            assert.equal(err.message, "Cannot call static method 'Worker.emit()' in a worker process.");
        }

        try {
            Worker.to("A");
        } catch (err) {
            assert.equal(err.message, "Cannot call static method 'Worker.to()' in a worker process.");
        }

        try {
            Worker.broadcast("some event");
        } catch (err) {
            assert.equal(err.message, "Cannot call static method 'Worker.broadcast()' in a worker process.");
        }
    }, 200);
}