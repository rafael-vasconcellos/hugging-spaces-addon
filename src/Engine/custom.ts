type IRateLimit = { 
    requests: number
    seconds: number
}

type IProgress = { 
    step: number
    startTime: number
}

interface ITranslationFailExceptionDTO { 
    message: string
    status?: number | string
}



function replaceNativeFunction() { 
    const originalFunc = trans.translateAllByRows?.toString()
    if (originalFunc) { 
        let customFunc = originalFunc.replace("escapedSentence.length > currentMaxLength", "false")
        customFunc = customFunc.replace(
            "escapedSentence.length+currentRequestLength", 
            "thisTranslator.job.batch[currentBatchID].length+1"
        )

        return eval(`(${customFunc})`)
    }

    return null
}

class CustomEngine { 
    private engine: TranslatorEngine
    private progress: Partial<IProgress> = {}
    private clear() { this.progress = {} }
    public optionsForm: TranslationEngineOptionForm
    constructor(engineOptions: TranslationEngineOptions) { 
        engineOptions.mode = "rowByRow"
        trans.translateAllByRows = replaceNativeFunction() ?? trans.translateAllByRows
        this.engine = new TranslatorEngine(engineOptions)
        this.engine.translate = this.translate.bind(this)
        this.engine.abort = this.clear.bind(this)
        this.engine.fetcher = this.fetcher.bind(this)
        this.optionsForm = new Proxy(this.getEngine().optionsForm, { 
            get(target, prop, receiver) {
                return target[prop as keyof TranslationEngineOptionForm]
            },
            set(target, prop, value, receiver) { 
                target[prop as keyof TranslationEngineOptionForm] = value
                return true
            }
        })
    }

    get api_key(): string | null { return this.getEngine()?.getOptions('api_key') ?? null }
    get target_language(): string { return this.getEngine()?.getOptions('target_language') ?? "English - US" }
    get api_type(): "free" | "pro" { return this.getEngine()?.getOptions('api_type') ?? "free" }
    get timeout(): number { return this.getEngine()?.getOptions('timeout') ?? 0 }

    public update(option: string, value: any) { 
        this.getEngine().update(option, value)
    }
    public getEngine() { return this.engine }
    public init() { this.engine.init() }
    public abort() { 
        trans.abortTranslation()
        this.clear()
    }

    public async fetcher(texts: string[]): Promise<string[]> { 
        throw new Error('Non implemented method!')
    }

    public translate(texts: string[], options: TranslatorOptions): void { 
        if (!this.api_key) { 
            alert('No API key specified!')
            return this.abort()
        }

        ui.log("\n\n" + "Batch size: " + texts.length);
        this.execute(texts)
            .then(result => options.onAfterLoading(result))
            .catch( (obj: TranslationFailException) => { 
                if (!obj.status) { ui.log(obj.stack) }
                options.onError(obj, undefined, obj.message)
            })
            .finally(options.always())
    }

    private mockTranslate(texts: string[]) { return new Promise(resolve => { 
        // @ts-ignore
        if (true) { 
            // @ts-ignore
            this.started = true
            //const mock_translation = Array(texts.length).fill('b')
            resolve({
                sourceText: texts.join(),
                translationText: texts.join(),
                source: texts,
                translation: texts
            })
        }
    })}

    protected async execute(texts: string[]): Promise<TranslatorEngineResults | void> { 
        return this.buildTranslationResult(texts)
    }

    protected async executeWithRateLimit(texts: string[], rateLimit: IRateLimit): Promise<TranslatorEngineResults> { 
        if (!this.progress.step) { 
            this.progress.step = 1
            this.progress.startTime = performance.now() 

        } else if ( (this.progress.step > rateLimit.requests) && this.progress.startTime ) { 
            const exec_time = performance.now() - this.progress.startTime
            const remaining_time = Math.max(0, (1000*rateLimit.seconds) - exec_time)
            this.progress = {}
            ui.log('Waiting ' + remaining_time/1000 + 's...')
            await new Promise(res => setTimeout(res, remaining_time)) 
        }

        const result = this.buildTranslationResult(texts)
        if (this.progress.step) { this.progress.step += 1 }
        return result
    }

    protected async buildTranslationResult(texts: string[]): Promise<TranslatorEngineResults> { 
        const promise = this.fetcher(texts).then(response => ({
			sourceText: texts.join(),
			translationText: response.join(),
			source: texts,
			translation: response
		}))
        if (!this.timeout) { return await promise }


        let timeoutId: NodeJS.Timeout
        const timeoutPromise = new Promise<any>((_, reject) => { 
            timeoutId = setTimeout(() => { 
                reject(new TranslationFailException({ 
                    status: 200,
                    message: "Request timed out!"
                }))
            }, this.timeout * 1000)
        })
        return Promise.race([
            promise.finally(() => clearTimeout(timeoutId)), // Limpa o timeout se a promise original resolver/rejeitar
            timeoutPromise
        ])
    }

    protected formatInput(texts: string[], n: number): (string | string[])[] { 
        const result = []
        for (let i=0; i<texts.length; i+=n) { 
            const batch = texts.slice(i, i+n)
            result.push(batch)
        }

        return result.length>1? result : result[0]
    }

}


declare class EngineClient extends CustomEngine { 
    constructor(thisAddon: Addon);
}


class TranslationFailException extends Error { 
    public status: ITranslationFailExceptionDTO['status']
    constructor(data: ITranslationFailExceptionDTO) { 
        super(data.message)
        this.status = data.status
    }
}


const CustomEngineModule = { CustomEngine, TranslationFailException }
export type ICustomEngineModule = typeof CustomEngineModule & { 
    EngineClient: typeof EngineClient
}
export type ICustomEngine = typeof CustomEngine

module.exports = CustomEngineModule

