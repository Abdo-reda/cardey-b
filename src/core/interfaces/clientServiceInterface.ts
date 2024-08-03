import type { Ref } from 'vue';
import type { IMessage } from './messageInterfaces/messageInterface';

export interface IClientService {
	peerConnection: RTCPeerConnection | undefined;
	dataChannel: RTCDataChannel | undefined;
	roomId: Ref<string>;
	onRecievedMessage?: (message: IMessage<any>) => void;
	onDataChannelOpen?: () => void;
	createJoinRequestAsync: (roomId: string) => Promise<string>;
	sendMessageToHost: <T>(message: IMessage<T>) => void;
}
