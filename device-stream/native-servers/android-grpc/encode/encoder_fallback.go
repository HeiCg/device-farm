//go:build !darwin

package encode

import "errors"

func newEncoder(_, _, _, _ int, _ Callback) (Encoder, error) {
	return nil, errors.New("encode: only darwin/VideoToolbox is supported — set DEVICE_STREAM_ANDROID_GRPC=0 to use scrcpy")
}
