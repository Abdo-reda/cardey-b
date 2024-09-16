import useGameState from '@/core/composables/useGameState';
import usePlayer from '@/core/composables/usePlayer';
import { MESSAGES_MAP, type MessageMethodPayloadMap } from '@/core/constants/messagesMap';
import { MessageMethodsEnum } from '@/core/enums/methodsEnum';
import type { IMessage } from '@/core/interfaces/messageInterfaces/messageInterface';

export class BaseMessage<E extends MessageMethodsEnum> implements IMessage<E> {
	method: E;
	senderId!: string;
	data!: MessageMethodPayloadMap[E];
	protected useGameState = useGameState();
	protected currentPlayer = usePlayer().currentPlayer;

	constructor(method: E) {
		this.method = method;
		MESSAGES_MAP.set(this.method, this);
	}

	init(senderId: string, data: MessageMethodPayloadMap[E]) {
		this.senderId = senderId;
		this.data = data;
		return this;
	}

	handle(): void {}
}
