import { MethodsEnum } from '@/core/enums/methodsEnum';
import { BaseMessage } from './baseMessage';
import type { Ref } from 'vue';
import type { IGameState } from '@/core/interfaces/gameStateInterface';

export class JoinGameMessage extends BaseMessage<MethodsEnum.JOIN_GAME> {
	constructor() {
		super(MethodsEnum.JOIN_GAME);
	}

	handle(gameState: Ref<IGameState>): void {
		gameState.value.players.push(this.data);
	}
}
