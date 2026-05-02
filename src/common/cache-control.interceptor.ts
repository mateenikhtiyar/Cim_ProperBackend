import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common"
import { Observable } from "rxjs"
import { tap } from "rxjs/operators"

/**
 * Adds `Cache-Control: private, max-age=10` to GET responses.
 *
 * Rationale: legitimate browser-level caching for 10 seconds absorbs the extremely
 * common "user clicks back, navigates, then forward" + React StrictMode double-render
 * pattern without a backend round-trip. `private` ensures shared proxies/CDNs
 * never cache user-specific data.
 *
 * Skipped when the response has already set Cache-Control (e.g., auth responses
 * that explicitly opt out with `no-store`).
 */
@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const req = http.getRequest()
    const res = http.getResponse()

    return next.handle().pipe(
      tap(() => {
        if (req.method !== "GET") return
        if (res.getHeader("Cache-Control")) return
        res.setHeader("Cache-Control", "private, max-age=10")
      }),
    )
  }
}
