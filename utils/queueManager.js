let waitingPlayers = [];

exports.addToQueue = function(player) {
    waitingPlayers.push(player);
};

exports.removeFromQueue = function() {
    return waitingPlayers.shift();  // Removes and returns the first player in the queue
};

exports.getQueue = function() {
    return waitingPlayers;
};
