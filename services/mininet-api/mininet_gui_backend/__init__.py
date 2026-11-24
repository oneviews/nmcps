__version__ = "0.3.0"

#: 契约标记：BFF 握手时比对（`layers/scenario/shared/constants/mininetApi.ts`）。
#: 加会话层（`/api/simulation/**`）就是一版新契约 —— 2.0 的引擎面不以 1.x 的
#: `/api/mininet/**` 为边界，两边版本对不上要能当场看出来。
LAB_API_CONTRACT = "2.0"
