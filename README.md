# Node.js 实时聊天系统文档

## 项目概述

基于 Node.js 和 Socket.IO 构建的实时聊天系统后端。该系统支持用户认证、一对一聊天、群聊、消息历史记录、在线状态检测等功能。

## 项目结构

```
chat-backend/
├── config/              # 配置文件
├── controllers/         # 控制器
├── middlewares/         # 中间件
├── models/              # 数据模型
├── routes/              # 路由
├── service/             # 业务逻辑服务
├── socket/              # Socket.IO 实时通信处理
├── utils/               # 工具类
├── client-test.html     # 客户端测试文件
├── package.json         # 项目依赖和脚本
└── server.js            # 主服务器文件
```

## 技术栈

- Node.js (使用 ES6 模块)
- Express.js - Web 框架
- MongoDB + Mongoose - 数据库
- Socket.IO - 实时通信
- JWT - 用户认证
- Bcrypt - 密码加密

## 安装和运行

### 环境要求

- Node.js >= 14
- MongoDB 数据库

### 安装步骤

1. 克隆项目到本地
2. 安装依赖：
   ```bash
   npm install
   ```

3. 配置环境变量：
   在项目根目录创建 `.env` 文件，包含以下内容：
   ```
   PORT=5000
   MONGO_URI=your_mongodb_connection_string
   JWT_SECRET=your_jwt_secret_key
   ```

4. 启动开发服务器：
   ```bash
   npm run dev
   ```

## API 接口文档

### 认证相关

#### 获取用户 Token
```
GET /api/auth/user?uid={uid}&name={name}
```
- 说明：根据主系统的用户ID和用户名获取通信token，如果用户不存在则创建用户
- 参数：
  - uid: 主系统的用户ID
  - name: 用户名

### 用户相关

#### 获取所有用户
```
GET /api/users
```
- 说明：获取所有用户（除自己）

#### 获取用户信息
```
GET /api/users/{id}
```
- 说明：获取指定ID的用户信息

#### 搜索用户
```
GET /api/users/search/{keyword}
```
- 说明：根据用户名或邮箱搜索用户

#### 获取在线用户
```
GET /api/users/online/list
```
- 说明：获取当前在线用户列表

### 消息相关

#### 发送消息
```
POST /api/messages
```
- 说明：发送一条消息
- 请求体：
  ```json
  {
    "conversationId": "会话ID",
    "receiverId": "接收者ID",
    "text": "消息内容"
  }
  ```

#### 获取会话消息
```
GET /api/messages/{conversationId}
```
- 说明：获取指定会话的所有消息

## Socket.IO 实时通信

系统使用 Socket.IO 实现实时通信功能，包括：

### 连接认证
客户端需要在连接时提供 JWT token：
```javascript
const socket = io('http://localhost:5000', {
  auth: {
    token: 'your_jwt_token'
  }
});
```

### 事件列表

#### 客户端发送事件

1. `get_conversations` - 获取用户会话列表
2. `create_conversation` - 创建新会话
   - 参数：`{ receiverIds: [用户ID数组] }`
3. `join_conversation` - 加入会话
   - 参数：`{ conversationId: "会话ID" }`
4. `send_message` - 发送消息
   - 参数：`{ conversationId: "会话ID", content: "消息内容" }`
5. `get_latest_msg` - 获取最新消息
   - 参数：`{ conversationId: "会话ID", page: 页码, pageSize: 每页数量 }`
6. `get_unread_msg_list` - 获取未读消息
   - 参数：`{ conversationId: "会话ID" }`

#### 服务端发送事件

1. `connect_res` - 连接结果
2. `get_conversations_res` - 会话列表
3. `create_conversation_res` - 创建会话结果
4. `join_conversation_res` - 加入会话结果
5. `receive_message` - 收到新消息
6. `message_sent` - 消息发送成功
7. `get_latest_msg_res` - 获取最新消息结果
8. `get_unread_msg_list_res` - 获取未读消息结果
9. `user_online` - 用户上线/下线通知

## 数据模型

### 用户模型 (User)
```javascript
{
  username: String,        // 用户名
  uid: Number,             // 主系统的用户ID
  role: String,            // 角色 ("user" 或 "admin")
  online: Boolean,         // 在线状态
  lastSeen: Date          // 最后在线时间
}
```

### 会话模型 (Conversation)
```javascript
{
  name: String,                           // 会话名称
  type: String,                           // 类型 ("private" 或 "group")
  participants: [ObjectId],              // 参与者
  lastMessage: ObjectId,                 // 最后一条消息
  unreadCount: Map,                      // 各用户未读消息数
  lastMessageAt: Date                   // 最后消息时间
}
```

### 消息模型 (Message)
```javascript
{
  conversationId: ObjectId,              // 会话ID
  senderId: ObjectId,                    // 发送者ID
  type: String,                          // 消息类型 ("text", "image", "file", "system")
  content: String,                       // 消息内容
  status: String,                        // 状态 ("sent", "delivered", "read")
  readBy: Map,                           // 各用户已读状态
  deleted: Boolean                       // 是否删除
}
```

## 开发指南

### 项目启动流程

1. 服务器启动 (`server.js`)：
   - 初始化 Express 应用
   - 连接 MongoDB 数据库
   - 设置中间件和路由
   - 启动 HTTP 服务器
   - 初始化 Socket.IO

### 代码规范

1. 使用 ES6 模块语法 (`import`/`export`)
2. 使用 async/await 处理异步操作
3. 错误处理遵循 try/catch 模式
4. 使用 Mongoose 进行数据库操作

### 添加新功能

1. 在 `models/` 目录下定义数据模型
2. 在 `service/` 目录下实现业务逻辑
3. 在 `controllers/` 目录下创建控制器
4. 在 `routes/` 目录下定义路由
5. 如需实时通信，在 `socket/chat.socket.js` 中添加相应事件处理

### 日志系统

项目内置日志系统，支持不同级别的日志记录：
- debug: 调试信息
- info: 一般信息
- warn: 警告信息
- error: 错误信息

使用方式：
```javascript
import { getLogger } from './utils/logger.js'
const logger = getLogger();
logger.info('日志信息');
```

## 部署说明

1. 确保服务器已安装 Node.js 和 MongoDB
2. 克隆项目到服务器
3. 安装依赖：`npm install`
4. 配置环境变量
5. 启动服务：`node server.js`

建议使用 PM2 等进程管理工具来运行生产环境的服务。

## 测试

项目包含一个简单的 HTML 客户端测试文件 (`client-test.html`)，可用于测试基本功能。

## 待完善功能

1. 添加消息加密功能
2. 实现文件上传和图片发送
3. 添加群组管理功能
4. 实现消息撤回功能

这个聊天系统提供了完整的实时通信功能，可以作为更复杂聊天应用的基础。