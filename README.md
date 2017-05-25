# Tic Tac Toe with Firebase

This repository contains the code that implements the Tic Tac Toe game that was presented during [my session at Google I/O 2017](https://www.youtube.com/watch?v=eWj6dxfN63g).

## Deploying the project

This project contains three main components: a web client deployed to Firebase Hosting, server-side logic deployed to Cloud Functions for Firebase, and Realtime Database security rules.

Here are the steps to deploy (assuming you're already [set up to build and deploy](https://firebase.google.com/docs/functions/get-started) code to Cloud Functions for Firebase on your computer):

1. Create a new Firebase project in the [Firebase console](http://console.firebase.google.com/).

2. In the console under Authentiction, enable sign-ins with Google auth.

3. Clone this repo.

4. On the command line, change to the repo root directory.

5. Run `firebase init` to initialize the project space.  Be sure to select each option (Database, Functions, Hosting) when prompted, then select the project you just created in the console.  Take all the subsequent defaults when prompted.

6. Run `firebase deploy` to deploy the web content, Cloud Functions, and database security rules.

7. When the deploy completes, you'll receive a URL to your project's main page hosted by Firebase Hosting.  Copy that into your browser to begin.

Note that the game requires that two different Google accounts be used to play against each other.  So, if you are trying this by yourself, you'll need use two different Google accounts in two different browser windows logged in at the same time.

## How it works

Players must sign in with a Google account before playing.  After signing in, a player can indicate that they want to play.  If two people are trying to play at the same time, the game will match the two players into a game.

The client side of the game lives in the `public` directory.  When deployed, the content is hosted by [Firebase Hosting](https://firebase.google.com/docs/hosting/).  It performs only two primary tasks.  First, it provides a UI to navigate and render the state of the game.  Second, it issues commands to the backend that express the intent of the player.  The client doesn't contain any of the rules of the game, and it makes no attempt to prevent the player from making an invalid move.  (Note that this is not necessarily great design, but it simulates the case where the game code has been compromised.)

The client code expresses the intent of the player by pushing a command under `/commands` into the database that describes the intent (e.g. looking for a player match, or making a move).

The backend of the game lives in the `functions` directory.  When deployed, the code is hosted by [Cloud Functions for Firebase](https://firebase.google.com/docs/functions/).  It contains and enforces all the rules of the game.  A function is invoked for each client command, the command is processed, and the results are written back to the database, with game data living under `/games`, individual player state under `/player_states`, and matching players under `/matching`.  The command data is then deleted.

## Author

My name is Doug Stevenson ([@CodingDoug](https://twitter.com/CodingDoug) on Twitter) and I'm a developer advocate with the Firebase team at Google.  I create content about Firebase on the [Firebase Channel on YouTube](https://www.youtube.com/firebase) and the [Firebase Blog](http://firebase.googleblog.com/) and speak at various events.
