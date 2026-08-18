import {
  NextAppRenderer,
  NextAppRuntimeProvider,
  type NextAppRuntime,
} from "@next-app-runtime/client";

export function WebsiteRenderer({ runtime }: { runtime: NextAppRuntime }) {
  return (
    <NextAppRuntimeProvider runtime={runtime}>
      <NextAppRenderer />
    </NextAppRuntimeProvider>
  );
}
