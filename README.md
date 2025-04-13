# MeetingMate 🎯

MeetingMate is a real-time meeting assistant that provides voice transcription and AI-powered insights to make your meetings more productive and efficient.

## 🚀 Features

- Real-time voice transcription
- AI-powered meeting insights
- Interactive user interface built with React and Tailwind CSS
- WebSocket-based real-time communication
- Express.js backend server

## 🛠️ Tech Stack

### Frontend
- React 18
- Vite
- Tailwind CSS
- Radix UI components
- React Markdown

### Backend
- Node.js
- Express.js
- WebSocket (ws)
- Axios for HTTP requests
- dotenv for environment variables

## 📋 Prerequisites

Before you begin, ensure you have the following installed:
- Node.js (LTS version recommended)
- npm (comes with Node.js)

## 🔧 Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd MeetingMate
```

2. Install dependencies for all components (client and server):
```bash
npm run install:all
```

## 🚀 Development

To run the development environment:

```bash
npm run dev
```

This will start both the client and server in development mode:
- Client: http://localhost:5173
- Server: http://localhost:3000

To run client and server separately:

```bash
# Run client only
npm run client

# Run server only
npm run server
```

## 🔑 Environment Variables

Create a `.env` file in the server directory with the following variables:

```env
# Add your environment variables here
```

## 📁 Project Structure

```
MeetingMate/
├── client/             # Frontend React application
│   ├── src/           # Source files
│   └── public/        # Static files
├── server/            # Backend Node.js server
│   ├── src/          # Source files
│   └── Services/     # Backend services
└── package.json      # Root package.json for project management
```
