import { type Reactive, reactive } from 'vue';
import type { IHostService } from '../interfaces/hostServiceInterface';
import {
	addDoc,
	collection,
	doc,
	DocumentReference,
	getDoc,
	onSnapshot,
	setDoc,
	updateDoc,
	type DocumentData
} from 'firebase/firestore';
import { cardeyBFireStore } from '@/core/services/firebaseService';
import { FirestoreConstants } from '../constants/firestoreConstants';
import { ChannelsEnum } from '../enums/channelsEnum';
import type { IMessage } from '../interfaces/messageInterfaces/messageInterface';
import type { MessageMethodsEnum } from '../enums/methodsEnum';

//maybe create a wrapper for peer connection? extension methods and so on ... I am not sure

export class HostService implements IHostService {
	roomId: string;
	peerConnections: Reactive<Map<string, RTCPeerConnection>>;
	dataChannels: Reactive<Map<string, RTCDataChannel>>;

	onPlayerJoinedDataChannel?: (playerId: string) => void;
	onPlayerClosedDataChannel?: (playerId: string) => void;
	onRecievedMessage?: (playerId: string, message: IMessage<any>) => void;

	constructor() {
		this.roomId = '';
		this.peerConnections = reactive(new Map());
		this.dataChannels = reactive(new Map());
	}

	sendMessageToPlayers<E extends MessageMethodsEnum>(
		message: IMessage<E>,
		playerIds: string[] = []
	): void {
		playerIds.forEach((playerId) => {
			const dataChannel = this.dataChannels.get(playerId);
			if (dataChannel && dataChannel.readyState === 'open')
				dataChannel.send(JSON.stringify(message, this.jsonParser));
		});
	}

	sendMessageToAllExcept<E extends MessageMethodsEnum>(
		message: IMessage<E>,
		exlucdedPlayerIds: string[] = []
	): void {
		this.dataChannels.forEach((dataChannel, playerId) => {
			if (!exlucdedPlayerIds.includes(playerId) && dataChannel.readyState === 'open') {
				dataChannel.send(JSON.stringify(message, this.jsonParser));
			}
		});
	}

	async createNewRoomAsync(): Promise<string> {
		const roomsCollection = collection(cardeyBFireStore, FirestoreConstants.roomsCollection);
		const newRoomId = await this.getUniqueRoomIdAsync();
		const roomDocRef = doc(roomsCollection, newRoomId);
		await setDoc(roomDocRef, {});

		console.log('--- Creating New room id: ', roomDocRef.id);
		this.listenToRoomJoinRequests(roomDocRef);
		this.roomId = roomDocRef.id;
		return roomDocRef.id;
	}

	private async getUniqueRoomIdAsync(): Promise<string> {
		const roomsCollection = collection(cardeyBFireStore, FirestoreConstants.roomsCollection);
		let newRoomId;
		let roomRef;
		let roomSnapshot;
		do {
			newRoomId = this.generateRoomId();
			roomRef = doc(roomsCollection, newRoomId);
			roomSnapshot = await getDoc(roomRef);
		} while (roomSnapshot.exists());

		return newRoomId;
	}

	private generateRoomId(): string {
		const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
		let roomId = '';
		for (let i = 0; i < 4; i++) {
			const randomIndex = Math.floor(Math.random() * characters.length);
			roomId += characters[randomIndex];
		}
		return roomId;
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
			// console.log(`Received data from player ${playerId}:`, event.data);
			const message = JSON.parse(event.data) as IMessage<any>;
			if (this.onRecievedMessage) this.onRecievedMessage(playerId, message);
		};

		dataChannel.onclose = () => {
			console.log(`Data channel closed with player ${playerId}`);
			if (this.onPlayerClosedDataChannel) this.onPlayerClosedDataChannel(playerId);
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

	disconnect(): void {
		this.dataChannels?.forEach((dataChannel) => {
			dataChannel.close();
		});
		this.peerConnections?.forEach((peerConnection) => {
			peerConnection.close();
		});
		this.roomId = '';
		this.peerConnections = reactive(new Map());
		this.dataChannels = reactive(new Map());
	}

	sendChatMessage(message: string) {}

	private jsonParser(key: string, value: any) {
		if (key == 'useGameState') return undefined;
		return value;
	}
}
