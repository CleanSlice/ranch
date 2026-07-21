import { ChatGateway } from '../data/chat.gateway';
import { ChatService } from '../domain/chat.service';

/**
 * Composition root for the admin chat slice. Builds the service graph
 * (service → gateway → mapper) once and provides it as `$chatService`. The
 * store resolves it lazily via `createServiceGetter`.
 */
export default defineNuxtPlugin({
  name: 'chat-di',
  setup() {
    const service = new ChatService(new ChatGateway());
    return {
      provide: {
        chatService: service,
      },
    };
  },
});
