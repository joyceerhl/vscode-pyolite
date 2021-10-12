import { KernelMessage } from '@jupyterlab/services';

import { IObservableDisposable } from '@lumino/disposable';

/**
 * An interface for a kernel running in the browser.
 */
 export interface IKernel extends IObservableDisposable {
    /**
     * The id of the server-side kernel.
     */
    readonly id: string;
  
    /**
     * The name of the server-side kernel.
     */
    readonly name: string;
  
    /**
     * A promise that is fulfilled when the kernel is ready.
     */
    readonly ready: Promise<void>;
  
    /**
     * Handle an incoming message from the client.
     *
     * @param msg The message to handle
     */
    handleMessage(msg: KernelMessage.IMessage): Promise<void>;
  
    /**
     * Handle a `kernel_info_request` message.
     *
     * @returns A promise that resolves with the kernel info.
     */
    kernelInfoRequest(): Promise<KernelMessage.IInfoReplyMsg['content']>;
  
    /**
     * Handle an `execute_request` message.
     *
     * @param content - The content of the execute_request kernel message
     */
    executeRequest(
      content: KernelMessage.IExecuteRequestMsg['content']
    ): Promise<KernelMessage.IExecuteReplyMsg['content']>;
  
    /**
     * Handle a `complete_request` message.
     *
     * @param content - The content of the request.
     */
    completeRequest(
      content: KernelMessage.ICompleteRequestMsg['content']
    ): Promise<KernelMessage.ICompleteReplyMsg['content']>;
  
    /**
     * Handle an `inspect_request` message.
     *
     * @param content - The content of the request.
     *
     * @returns A promise that resolves with the response message.
     */
    inspectRequest(
      content: KernelMessage.IInspectRequestMsg['content']
    ): Promise<KernelMessage.IInspectReplyMsg['content']>;
  
    /**
     * Handle an `is_complete_request` message.
     *
     * @param content - The content of the request.
     *
     * @returns A promise that resolves with the response message.
     */
    isCompleteRequest(
      content: KernelMessage.IIsCompleteRequestMsg['content']
    ): Promise<KernelMessage.IIsCompleteReplyMsg['content']>;
  
    /**
     * Handle a `comm_info_request` message.
     *
     * @param content - The content of the request.
     *
     * @returns A promise that resolves with the response message.
     */
    commInfoRequest(
      content: KernelMessage.ICommInfoRequestMsg['content']
    ): Promise<KernelMessage.ICommInfoReplyMsg['content']>;
  
    /**
     * Send an `input_reply` message.
     *
     * @param content - The content of the reply.
     */
    inputReply(content: KernelMessage.IInputReplyMsg['content']): void;
  }
  


/**
 * A namespace for IKernel statics.
 */
 export namespace IKernel {
    /**
     * The type for the send message function.
     */
    export type SendMessage = (msg: KernelMessage.IMessage) => void;
  
    /**
     * The instantiation options for an IKernel.
     */
    export interface IOptions {
      /**
       * The kernel id.
       */
      id: string;
  
      /**
       * The name of the kernel.
       */
      name: string;
  
      /**
       * The method to send messages back to the server.
       */
      sendMessage: SendMessage;
    }
  }
  
