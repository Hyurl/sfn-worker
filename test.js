const { Worker, isMaster } = require("./");

if (isMaster) {
    // Master process
    // Create two workers A and B, and keep them alive.
    new Worker("A", true);
    new Worker("B", true);

    // Do logics when the worker is online.
    Worker.on("online", (worker) => {
        worker.on("greeting from worker", (msg) => {
            console.log("Worker %s: %s", worker.id, msg);

            // greet back
            worker.emit("greeting from master", `Hello, worker ${worker.id}!`);
        });
    });
} else {
    // Worker process
    Worker.on("online", worker => {
        worker.emit("greeting from worker", `Hi, master, I'm worker ${worker.id}!`);

        worker.on("greeting from master", msg => {
            console.log("Master: %s", msg);
        }).on("greeting from another worker", (id, msg) => {
            console.log("Worker %s: %s", id, msg);

            // greet back
            worker.to(id).emit("greeting back to another worker", worker.id, `Nice to meet you, worker ${id}!`);
        }).on("greeting back to another worker", (id, msg) => {
            console.log("Worker %s: %s", id, msg);
        });

        if (worker.id === "A") {
            worker.to("B").emit("greeting from another worker", "A", `Hi, worker B, I'm worker A!`);
        }
    });
}