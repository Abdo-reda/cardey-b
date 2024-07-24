import { type Ref, type Reactive, ref, reactive } from 'vue';
import type { IHostService } from '../../../interfaces/host/webRTC/hostServiceInterface';
import {
	addDoc,
	collection,
	DocumentReference,
	onSnapshot,
	updateDoc,
	type DocumentData
} from 'firebase/firestore';
import { cardeyBFireStore } from '@/core/services/firebaseService';
import { FirestoreConstants } from '../../../constants/firestoreConstants';
import { ChannelsEnum } from '../../../enums/channelsEnum';
import type { IMessage } from '../../../interfaces/common/messageInterface';

//maybe create a wrapper for peer connection? extension methods and so on ... I am not sure

export class HostService implements IHostService {
	roomId: Ref<string>;
	peerConnections: Reactive<Map<string, RTCPeerConnection>>;
	dataChannels: Reactive<Map<string, RTCDataChannel>>;

	onPlayerJoinedDataChannel?: (playerId: string) => void;
	onReceivedMessage?: (playerId: string, message: IMessage<any>) => void;

	constructor() {
		this.roomId = ref('');
		this.peerConnections = reactive(new Map());
		this.dataChannels = reactive(new Map());
	}

	sendMessageToPlayers<T>(message: IMessage<T>, playerIds: string[] = []): void {
		playerIds.forEach((playerId) => {
			const dataChannel = this.dataChannels.get(playerId);
			if (dataChannel && dataChannel.readyState === 'open')
				dataChannel.send(JSON.stringify(message));
		});
	}

	sendMessageToAllExcept<T>(message: IMessage<T>, exlucdedPlayerIds: string[] = []): void {
		this.dataChannels.forEach((dataChannel, playerId) => {
			if (!exlucdedPlayerIds.includes(playerId) && dataChannel.readyState === 'open') {
				dataChannel.send(JSON.stringify(message));
			}
		});
	}

	async createNewRoomAsync(): Promise<string> {
		const roomsCollection = collection(cardeyBFireStore, FirestoreConstants.roomsCollection);
		const newRoomDoc = await addDoc(roomsCollection, {});

		console.log('--- Creating New room id: ', newRoomDoc.id);
		this.listenToRoomJoinRequests(newRoomDoc);
		this.roomId.value = newRoomDoc.id;
		return newRoomDoc.id;
	}

	private listenToRoomJoinRequests(roomDoc: DocumentReference<DocumentData, DocumentData>): void {
		console.log('--- Listening to Room Join Requests');

		const roomJoinRequestsCollection = collection(
			roomDoc,
			FirestoreConstants.joinRequestsCollection
		);

		onSnapshot(roomJoinRequestsCollection, (snapshot) => {
			console.log('JoinRequests Collection changes: ', snapshot.docChanges());

			snapshot.docChanges().forEach(async (change) => {
				if (change.type === 'added') {
					const joinRequestDoc = change.doc.ref;
					console.log('A new join request has been added: ', joinRequestDoc);
					if (joinRequestDoc) {
						await this.createPeerConnectionAsync(joinRequestDoc);
					}
				}
			});
		});
	}

	/**
	 * Creates a peer connection for a given joinRequest (a new player), this sets the offer candidate and listens for answer candidates
	 * @param joinRequestDoc
	 */
	private async createPeerConnectionAsync(
		joinRequestDoc: DocumentReference<DocumentData>
	): Promise<void> {
		console.log('--- Creating Peer Connection, joinRequestDoc', joinRequestDoc);
		const offerCandidates = collection(
			joinRequestDoc,
			FirestoreConstants.offerCandidatesCollection
		);

		const pc = new RTCPeerConnection(FirestoreConstants.serversConfiguration);

		this.createGameDataChannel(joinRequestDoc.id, pc);

		pc.onicecandidate = async (event) => {
			if (event.candidate) await addDoc(offerCandidates, event.candidate.toJSON());
		};

		// create offer
		const offerDescription = await pc.createOffer();
		await pc.setLocalDescription(new RTCSessionDescription(offerDescription));

		// config for offer
		const offer = {
			sdp: offerDescription.sdp,
			type: offerDescription.type
		};

		await updateDoc(joinRequestDoc, { offer });

		this.listenToAnswerCandidates(pc, joinRequestDoc);
		this.peerConnections.set(joinRequestDoc.id, pc);
	}

	private createGameDataChannel(playerId: string, pc: RTCPeerConnection) {
		console.log('--- Creating Data Channel');
		const dataChannel = pc.createDataChannel(ChannelsEnum.GAME_DATA);

		dataChannel.onopen = () => {
			console.log(`Data channel open with player ${playerId}`);
			// this.sendMessageToAllExcept(`New Player Joined, say hi! ${playerId}`);
			if (this.onPlayerJoinedDataChannel) this.onPlayerJoinedDataChannel(playerId);
		};

		dataChannel.onmessage = (event: MessageEvent<string>) => {
			console.log(`Received data from player ${playerId}:`, event.data);
			const message = JSON.parse(event.data) as IMessage<any>;
			if (this.onReceivedMessage) this.onReceivedMessage(playerId, message);
		};

		this.dataChannels.set(playerId, dataChannel);
	}

	/**
	 * Listens to answer candidates and sets the remote description of the peer connection
	 * @param pc
	 * @param joinRequestDoc
	 */
	private listenToAnswerCandidates(
		pc: RTCPeerConnection,
		joinRequestDoc: DocumentReference<DocumentData>
	) {
		console.log('---- listen to answer candidates');
		const answerCandidates = collection(
			joinRequestDoc,
			FirestoreConstants.answerCandidatesCollection
		);

		onSnapshot(joinRequestDoc, (snapshot) => {
			console.log('-- join request changed');
			const data = snapshot.data();

			if (!pc.currentRemoteDescription && data?.answer) {
				const answerDescription = new RTCSessionDescription(data.answer);
				pc.setRemoteDescription(answerDescription);
			}
		});

		// if answered add candidates to peer connection
		onSnapshot(answerCandidates, (snapshot) => {
			snapshot.docChanges().forEach((change) => {
				if (change.type === 'added') {
					const candidate = new RTCIceCandidate(change.doc.data());
					pc.addIceCandidate(candidate);
				}
			});
		});
	}
}
