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

class Game {
    constructor() {
        console.log("Game time!")
        this.db = firebase.database()
        this._reset()

        this.playerPieceClasses = {
            "1": "playerX",
            "2": "playerO"
        }
    }

    _reset() {
        this.gameId = undefined
        this.refPlayerState = undefined
        this.refCommands = undefined
    }

    onLoad(event) {
        this._initUi()
        this._initFirebaseAuth()
    }

    _initUi() {
        this.elLoginScreen = document.getElementById("login-screen")
        this.elOptionsScreen = document.getElementById("options-screen")
        this.elMatchingScreen = document.getElementById("matching-screen")
        this.elGameScreen = document.getElementById("game-screen")
        this.allScreens = [ this.elLoginScreen, this.elOptionsScreen, this.elMatchingScreen, this.elGameScreen ]

        this.elMessage = this.elGameScreen.querySelector(".message")
        this.elPlayer1 = this.elGameScreen.querySelector(".player1")
        this.elPlayer2 = this.elGameScreen.querySelector(".player2")

        this.elSpaces = []

        this.elCurrentScreen = null
        this._showScreen()

        const btn_sign_in = document.getElementById("btn-sign-in")
        btn_sign_in.addEventListener("click", event => {
            var provider = new firebase.auth.GoogleAuthProvider()
            provider.addScope("profile")
            firebase.auth().signInWithRedirect(provider)
            firebase.auth().getRedirectResult()
            .then(result => {
                console.log("auth success")
                console.log(result)
                // This gives you a Google Access Token. You can use it to access the Google API.
                var token = result.credential.accessToken
                // The signed-in user info.
                var user = result.user
                // ...
            })
            .catch(error => {
                console.log("auth error")
                // Handle Errors here.
                var errorCode = error.code;
                var errorMessage = error.message;
                // The email of the user's account used.
                var email = error.email;
                // The firebase.auth.AuthCredential type that was used.
                var credential = error.credential;
                // ...
            })
        })

        const btn_sign_out = document.getElementById("btn-sign-out")
        btn_sign_out.addEventListener("click", event => {
            firebase.auth().signOut()
        })

        const btn_play = document.getElementById("btn-play")
        btn_play.addEventListener("click", event => {
            this._sendCommand({ command: "match" })
        })

        const el_game_board = this.elGameScreen.querySelector(".game-board")
        for (let x = 0; x < 3; x++) {
            this.elSpaces[x] = []
            for (let y = 0; y < 3; y++) {
                const sp = el_game_board.querySelector(`.sp-x${x}-y${y}`)
                sp.addEventListener("click", event => {
                    console.log(`click x=${x} y=${y}`)
                    // if it's my turn...
                    this._makeMove(x, y)
                })
                this.elSpaces[x][y] = sp
            }
        }
    }

    _sendCommand(command) {
        if (this.sendingCommand) {
            console.log("Throttling command")
            return
        }
        this.sendingCommand = true
        this.refCommands.push(command)
        .then(result => {
            this.sendingCommand = false
        })
    }

    _showScreen(screen) {
        this.allScreens.forEach(sc => {
            if (sc === screen) {
                sc.style.display = ""
                this.elCurrentScreen = screen
            }
            else {
                sc.style.display = "none"
            }
        })
    }

    _initFirebaseAuth() {
        firebase.auth().onAuthStateChanged(this._onAuthStateChanged.bind(this))
    }

    _onAuthStateChanged(user) {
        if (user) {
            console.log(`signed in ${user.displayName}`)
            console.log(user)
            this._onSignIn(user)
            if (this.elCurrentScreen === this.elLoginScreen || !this.elCurrentScreen) {
                this._showScreen(this.elOptionsScreen)
            }
        }
        else {
            console.log("signed out")
            this._onSignOut()
            this._showScreen(this.elLoginScreen)
        }
    }

    _onSignIn(user) {
        this.user = user
        this.refPlayerState = this.db.ref(`/player_states/${user.uid}`)
        this.refCommands = this.db.ref(`/commands/${user.uid}`)
        this.onPlayerStateChanged = this.refPlayerState.on("value", this._onPlayerStateChanged.bind(this))
        this.db.ref(`/players/${user.uid}`).update({
            displayName: user.displayName,
            photoUrl: user.photoURL
        })
    }

    _onSignOut() {
        if (this.refPlayerState) {
            this.refPlayerState.off("value", this.onPlayerStateChanged)
            this.refPlayerState = undefined
        }
        this.refCommands = undefined
        this.user = null
        if (this.checkin) {
            clearInterval(this.checkin)
            this.checkin = undefined
        }
        this._reset()
    }

    _onPlayerStateChanged(snap) {
        console.log("onPlayerStateChanged")
        const state = snap.val() || {}
        console.log(state)
        if (state.matching) {
            this._showScreen(this.elMatchingScreen)
        }
        else if (state.game) {
            this._showScreen(this.elGameScreen)
            if (!this.refGameState) {
                this._enterGame(state.game)
            }
        }
        else {
            // Stay on the game screen if the game is over
            if (this.elCurrentScreen !== this.elGameScreen) {
                this._showScreen(this.elOptionsScreen)
            }
        }
        if (state.message) {
            this.elMessage.textContent = state.message
        }
    }

    _enterGame(game_id) {
        console.log("enterGame " + game_id)
        this.gameId = game_id;
        this.refGameState = this.db.ref(`/games/${game_id}`)
        this.onGameStateChanged = this.refGameState.on("value", this._onGameStateChanged.bind(this))
        this.checkin = setInterval(this._checkin.bind(this), 10000)
        console.log(this.refGameState)
    }

    _checkin() {
        console.log("checkin")
        this._sendCommand({ command: "checkin" })
    }

    _exitGame() {
        console.log("exitGame " + this.gameId)
        if (this.gameId) {
            this.refGameState.off("value", this.onGameStateChanged)
        }
        this.gameId = undefined
        this.refGameState = undefined
        this.onGameStateChanged = undefined
        if (this.checkin) {
            clearInterval(this.checkin)
            this.checkin = undefined
        }
    }

    _updatePlayerUi(el, snap) {
        const player = snap.val()
        console.log(player)
        const name = player.displayName === "" ? "???" : player.displayName
        el.querySelector(".name").textContent = name
        el.querySelector(".profile-pic").src = player.photoUrl + "?sz=100"
    }

    _onGameStateChanged(snap) {
        console.log("onGameStateChanged")
        const state = snap.val()
        console.log(state)
        if (!state) {
            this._showScreen(this.elOptionsScreen)
        }

        this.db.ref(`/players/${state.p1uid}`).once("value")
            .then(this._updatePlayerUi.bind(this, this.elPlayer1))
        this.db.ref(`/players/${state.p2uid}`).once("value")
            .then(this._updatePlayerUi.bind(this, this.elPlayer2))

        // Initialize the game board display spaces
        for (let x = 0; x < 3; x++) {
            for (let y = 0; y < 3; y++) {
                this.elSpaces[x][y].firstElementChild.className = "piece"
            }
        }

        // Apply all the moves logged so far in the game
        snap.child("moves").forEach(snap => {
            const move = snap.val()
            const space = this.elSpaces[move.x][move.y]
            space.firstElementChild.classList.add(this.playerPieceClasses[move.player])
        })

        // Game is over
        if (state.outcome) {
            this._exitGame()
            return
        }
    }

    _makeMove(x, y) {
        console.log("Making my move...")
        this._sendCommand({
            command: "move",
            x: x,
            y: y
        })
    }
}

const app = new Game()
window.addEventListener("load", app.onLoad.bind(app))
