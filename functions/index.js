/*
Copyright 2017 Google Inc.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const functions = require('firebase-functions')
const checkin_period = 20000

exports.command = functions.database
        .ref('/commands/{uid}/{cmd_id}')
        .onWrite(event => {
    const uid = event.params.uid
    const cmd_id = event.params.cmd_id

    if (! event.data.exists()) {
        console.log(`command was deleted ${cmd_id}`)
        return
    }

    const command = event.data.val()
    const cmd_name = command.command
    console.log(`command ${cmd_name} uid=${uid} cmd_id=${cmd_id}`)
    const root = event.data.adminRef.root
    let pr_cmd
    switch (cmd_name) {
        case 'match':
            pr_cmd = match(root, uid)
            break
        case 'move':
            pr_cmd = move(root, uid, command)
            break
        case 'checkin':
            pr_cmd = checkin(root, uid)
            break
        default:
            console.log(`Unknown command: ${cmd_name}`)
            pr_cmd = Promise.reject("Unknown command")
            break
    }

    const pr_remove = event.data.adminRef.remove()
    return Promise.all([pr_cmd, pr_remove])
})

/**
 * 
 * @param {admin.database.Reference} root
 * @param {string} uid
 * @type {Promise}
 */
function match(root, uid) {
    let p1uid, p2uid
    return root.child('matching').transaction((data) => {
        if (data === null) {
            console.log(`${uid} waiting for match`)
            return { uid: uid }
        }
        else {
            p1uid = data.uid
            p2uid = uid
            if (p1uid === p2uid) {
                console.log(`${p1uid} tried to match with self!`)
                return
            }
            else {
                console.log(`matched ${p1uid} with ${p2uid}`)
                return {}
            }
        }
    },
    (error, committed, snapshot) => {
        if (error) {
            throw error
        }
        else {
             return {
                committed: committed,
                snapshot: snapshot
            }
        }
    },
    false)
    .then(result => {
        const matching = result.snapshot.val()
        if (matching && matching.uid) {
            return root.child(`player_states/${uid}`).set({
                matching: true
            })
        }
        else {
            // Create a new game state object and push it under /games
            const now = new Date().getTime()
            const ref_game = root.child("games").push()
            const pr_game = ref_game.set({
                p1uid: p1uid,
                p2uid: p2uid,
                turn: p1uid,
                p1checkin: now,
                p2checkin: now
            })
            const game_id = ref_game.key
            console.log(`starting game ${game_id} with p1uid: ${p1uid}, p2uid: ${p2uid}`)
            const pr_state1 = root.child(`player_states/${p1uid}`).set({
                game: game_id,
                message: "It's your turn! Make a move!"
            })
            const pr_state2 = root.child(`player_states/${p2uid}`).set({
                game: game_id,
                message: "Waiting for other player..."
            })
            return Promise.all([pr_game, pr_state1, pr_state2])
        }
    })
}


/**
 * 
 * @param {admin.database.Reference} root
 * @param {string} uid
 * @param {object} command
 * @type {Promise}
 */
function move(root, uid, command) {
    const x = parseInt(command.x)
    const y = parseInt(command.y)
    if (x < 0 || x > 2 || y < 0 || y > 2) {
        throw new Error("That move is out of bounds!")
    }

    const ref_self_state = root.child("player_states/" + uid)
    let ref_other_state
    let ref_game_state
    let self_state

    return ref_self_state.once("value")
    .then(snap => {
        self_state = snap.val()
        if (self_state && self_state.game) {
            return transactMove(root, uid, self_state.game, x, y)
        }
        else {
            throw new Error("You're not in a game")
        }
    })
    .catch(reason => {
        console.log("Move failed")
        console.log(reason)
        return ref_self_state.update({
            message: reason.message
        })
    })
}


/**
 * 
 * @param {admin.database.Reference} root
 * @param {string} uid
 * @param {string} game_id
 * @param {number} x
 * @param {number} y
 * @type {Promise}
 */
function transactMove(root, uid, game_id, x, y) {
    // Make changes to the game state safely in a transaction
    let move_error
    root.child(`games/${game_id}`).transaction(game_state => {
        console.log("transactMove")
        console.log(game_state)
        if (game_state == null) {
            return null
        }
        try {
            return checkAndApplyMove(root, uid, game_state, x, y)
        }
        catch (error) {
            move_error = error
            return
        }
    },
    (error, committed, snapshot) => {
        console.log("transactMove end")
        if (error) {
            console.log(error)
            throw error
        }
        else if (!committed) {
            console.log("Not committed, move error")
            console.log(move_error)
            return {
                message: move_error.message
            }
        }
        else {
            console.log("Committed move")
            return {
                committed: committed,
                snapshot: snapshot
            }
        }
    },
    false)
    .then(result => {
        if (result.committed) {
            return notifyPlayers(root, uid, result.snapshot.val())
        }
        else {
            return root.child(`player_states/${uid}`).update({
                message: result.message
            })
        }
    })
}


/**
 * 
 * @param {admin.database.Reference} root
 * @param {string} uid
 * @param {object} game_state
 * @param {number} x
 * @param {number} y
 * @type {object}
 */
function checkAndApplyMove(root, uid, game_state, x, y) {
    if (game_state.outcome) {
        throw new Error("Game is over!")
    }

    const p1uid = game_state.p1uid
    const p2uid = game_state.p2uid

    let pl_num
    if (uid === p1uid) {
        pl_num = 1
    }
    else if (uid === p2uid) {
        pl_num = 2
    }
    else {
        throw new Error("You're not playing this game!")
    }

    // Check if it's my turn
    const turn = game_state.turn
    if (uid !== game_state.turn) {
        throw new Error("It's not your turn. Be patient!")
    }

    // Build an empty 2d view of game board
    const spaces = []
    for (let i = 0; i < 3; i++) {
        spaces[i] = []
        for (let j = 0; j < 3; j++) {
            spaces[i][j] = undefined
        }
    }

    if (!game_state.moves) {
        game_state.moves = []
    }

    game_state.moves.forEach(move => {
        spaces[move.x][move.y] = move.player
    })

    // Check that the space is free
    if (spaces[x][y]) {
        throw new Error("You can't move there - space already taken!")
    }

    // Simulate this move in our 2d space and check for a end condition
    spaces[x][y] = pl_num
    const end = checkEndgame(spaces)

    // Record the move
    game_state.moves.push({
        player: pl_num,
        x: x,
        y: y
    })

    if (end) {
        game_state.turn = null
        if (end.winner == 1) {
            game_state.outcome = 'win_p1'
            game_state.win_moves = end.win_moves
        }
        else if (end.winner == 2) {
            game_state.outcome = 'win_p2'
            game_state.win_moves = end.win_moves
        }
        else if (end.tie) {
            game_state.outcome = 'tie'
        }
    }
    else {
        // Other player's turn now
        game_state.turn = pl_num == 1 ? p2uid : p1uid
    }

    return game_state
}


/**
 * Update each players' individual states given the entire game state.
 * 
 * @param {admin.database.Reference} root
 * @param {string} uid
 * @param {object} game_state
 * @type {Promise}
 */

function notifyPlayers(root, uid, game_state) {
    // Figure out what message should be displayed for each player
    let p1_message, p2_message
    if (game_state.outcome) {
        const outcome = game_state.outcome
        if (outcome === 'win_p1') {
            p1_message = "You won! Good job!"
            p2_message = "They won! Better luck next time!"
        }
        else if (outcome === 'win_p2') {
            p1_message = "They won! Better luck next time!"
            p2_message = "You won! Good job!"
        }
        else if (outcome === 'tie') {
            p1_message = p2_message = "It's a tie game!"
        }
        else if (outcome == 'forfeit_p1') {
            p1_message = "Looks like you gave up."
            p2_message = "The other player has apparently quit, so you win!"
        }
        else if (outcome == 'forfeit_p2') {
            p1_message = "The other player has apparently quit, so you win!"
            p2_message = "Looks like you gave up."
        }
    }
    else {
        if (game_state.turn === game_state.p1uid) {
            p1_message = "It's your turn! Make a move!"
            p2_message = "Waiting for other player..."
        }
        else {
            p1_message = "Waiting for other player..."
            p2_message = "It's your turn! Make a move!"
        }
    }

    if (p1_message && p2_message) {
        const update_p1 = { message: p1_message }
        const update_p2 = { message: p2_message }
        if (game_state.outcome) {
            update_p1.game = update_p2.game = null
        }

        // Perform the updates
        // Construct refs to each players' inividual state locations
        // const ref_self_state = root.child(`player_states/${uid}`)
        const ref_p1_state = root.child(`player_states/${game_state.p1uid}`)
        const ref_p2_state = root.child(`player_states/${game_state.p2uid}`)
        const pr_update_p1 = ref_p1_state.update(update_p1)
        const pr_update_p2 = ref_p2_state.update(update_p2)
        return Promise.all([pr_update_p1, pr_update_p2])
    }
    else {
        throw new Error("Unexpected case for notifications")
    }
}


/**
 * 
 * @param {admin.database.Reference} root
 * @param {string} uid
 * @type {Promise}
 */
function checkin(root, uid) {
    const ref_self_state = root.child(`player_states/${uid}`)
    return ref_self_state.once("value")
    .then(snap => {
        const self_state = snap.val()
        if (self_state && self_state.game) {
            return transactCheckin(root, uid, self_state.game)
        }
        else {
            throw new Error("You're not in a game")
        }
    })
}


/**
 * 
 * @param {admin.database.Reference} root
 * @param {string} uid
 * @type {Promise}
 */
function transactCheckin(root, uid, game_id) {
    root.child(`games/${game_id}`).transaction(game_state => {
        console.log("transactCheckin")
        console.log(game_state)
        if (game_state == null) {
            return null
        }
        return checkPlayerTimeout(root, uid, game_state)
    },
    (error, committed, snapshot) => {
        console.log("transactCheckin end")
        if (error) {
            console.log(error)
            throw error
        }
        else {
            return {
                committed: committed,
                snapshot: snapshot
            }
        }
    },
    false)
    .then(result => {
        if (result.committed) {
            return notifyPlayers(root, uid, result.snapshot.val())
        }
    })
}

/**
 * Look at the game state and figure out if the other player has ghosted,
 * forfeiting the game.
 * 
 * @param {admin.database.Reference} root
 * @param {string} uid
 * @param {object} game_state
 * @type {object}
 */
function checkPlayerTimeout(root, uid, game_state) {
    if (game_state.outcome) {
        throw new Error("Game is over, client shouldn't be checking in")
    }

    const p1uid = game_state.p1uid
    const p2uid = game_state.p2uid
    const p1checkin = game_state.p1checkin
    const p2checkin = game_state.p2checkin
    const now = new Date().getTime()

    if (p1uid === uid) {
        // P1 checkins check that P2 has been also checking in
        if (p2checkin + checkin_period * 2 < now) {
            game_state.outcome = 'forfeit_p2'
        }
        game_state.p1checkin = now
    }
    else if (p2uid === uid) {
        // P2 checkins check that P1 has been also checking in
        if (p1checkin + checkin_period * 2 < now) {
            game_state.outcome = 'forfeit_p1'
        }
        game_state.p2checkin = now
    }
    else {
        throw new Error(`uid ${uid} is not in this game`)
    }

    return game_state
}


const wins = [
    // Verticals
    [ [0,0], [0,1], [0,2] ],
    [ [1,0], [1,1], [1,2] ],
    [ [2,0], [2,1], [2,2] ],
    // Horizontals
    [ [0,0], [1,0], [2,0] ],
    [ [0,1], [1,1], [2,1] ],
    [ [0,2], [1,2], [2,2] ],
    // Diagonals
    [ [0,0], [1,1], [2,2] ],
    [ [2,0], [1,1], [0,2] ]
]

function checkEndgame(spaces) {
    for (let i = 0; i < wins.length; i++) {
        const win = wins[i]
        const m1 = win[0],
              m2 = win[1],
              m3 = win[2]
        const t1 = spaces[m1[0]][m1[1]],
              t2 = spaces[m2[0]][m2[1]],
              t3 = spaces[m3[0]][m3[1]]
        if (t1 && t2 && t3 && t1 == t2 && t1 == t3) {
            return {
                winner: t1,
                win_moves: win
            }
        }
    }

    // If all the spaces are filled, it's a tie
    for (let x = 0; x < 3; x++) {
        for (let y = 0; y < 3; y++) {
            if (spaces[x][y] === undefined) {
                // Still empty spaces, game not over
                return undefined
            }
        }
    }

    return { tie: true }
}
