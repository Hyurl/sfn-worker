const { Worker, isMaster } = require("./");
const assert = require("assert");
const util = require("util");

if (isMaster) {
    // Master process
    // Create two workers A and B, and keep them alive.
    new Worker("A", true);
    new Worker("B", true);

    // Do logics when the worker is online.
    Worker.on("online", (worker) => {
        worker.on("greeting from worker", (msg) => {
            assert.equal(msg, `Hi, master, I'm worker ${worker.id}!`);

            // greet back
            worker.emit("greeting from master", `Hello, worker ${worker.id}!`);
        });
    });

    setTimeout(() => {
        console.log("All tests passed!");
        process.exit();
    }, 1000);
} else {
    // Worker process
    Worker.on("online", worker => {
        worker.emit("greeting from worker", `Hi, master, I'm worker ${worker.id}!`);

        worker.on("greeting from master", msg => {
            assert.equal(msg, `Hello, worker ${worker.id}!`);
        }).on("greeting from another worker", (id, msg) => {
            assert.equal(msg, "Hi, worker B, I'm worker A!");

            // greet back
            worker.to(id).emit("greeting back to another worker", worker.id, `Nice to meet you, worker ${id}!`);
        }).on("greeting back to another worker", (id, msg) => {
            assert.equal(msg, "Nice to meet you, worker A!");
        });

        if (worker.id === "A") {
            worker.to("B").emit("greeting from another worker", "A", "Hi, worker B, I'm worker A!");
        }
    });
}