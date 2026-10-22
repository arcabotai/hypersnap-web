import { QuorumApiClient } from '../../api/baseTypes';
import { memo, useEffect, useMemo, useRef } from 'react';
import { getConfig } from '../../config/config';
import {
  QuorumApiClientContext,
  QuorumApiClientProviderProps,
} from './QuorumApiContextState';

export const QuorumApiClientProvider = memo(
  ({
    baseUrl = getConfig().quorumApiUrl,
    wsUrl,
    children,
    debug = false,
    fetch,
    mutateTimeout,
    onError,
    onFetchStart,
    onSuccess,
    onTimeout,
    readTimeout,
    signMessage,
    timeoutRetryDecayFactor,
    checkOffline,
  }: QuorumApiClientProviderProps) => {
    const options = useMemo(() => {
      return {
        baseUrl,
        wsUrl,
        debug,
        fetch,
        mutateTimeout,
        onError,
        onFetchStart,
        onSuccess,
        onTimeout,
        readTimeout,
        timeoutRetryDecayFactor,
        checkOffline,
      };
    }, [
      baseUrl,
      wsUrl,
      debug,
      fetch,
      mutateTimeout,
      onError,
      onFetchStart,
      onSuccess,
      onTimeout,
      readTimeout,
      timeoutRetryDecayFactor,
      checkOffline,
    ]);

    const apiClient = useRef<QuorumApiClient>(undefined);

    useEffect(() => {
      if (!apiClient.current) {
        apiClient.current = new QuorumApiClient(options);
      }

      apiClient.current?.updateOptions(options);
    }, [apiClient, options]);

    const derivedApiClient = useMemo(() => {
      if (apiClient.current) {
        return apiClient.current;
      }

      return new QuorumApiClient(
        options || {
          baseUrl: getConfig().quorumApiUrl,
          meta: {},
        }
      );
    }, [apiClient, options]);

    const contextValue = useMemo(
      () => ({
        apiClient: derivedApiClient,
        baseUrl,
        signMessage,
      }),
      [baseUrl, derivedApiClient, signMessage]
    );

    return useMemo(
      () => (
        <QuorumApiClientContext.Provider value={contextValue}>
          {children}
        </QuorumApiClientContext.Provider>
      ),
      [children, contextValue]
    );
  }
);

QuorumApiClientProvider.displayName = 'QuorumApiClientProvider';
